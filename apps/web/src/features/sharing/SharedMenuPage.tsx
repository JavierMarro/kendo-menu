import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link, useParams } from 'react-router-dom';

import type { TrainingActivity } from '@kendo-menu/domain';
import {
  parseSharedMenuV1,
  type SharedMenuExerciseV1,
  type SharedMenuV1,
} from '@kendo-menu/domain/menu-sharing';
import { TrainingActivityList } from '../../components/TrainingActivityList';
import { TrainingSetTags } from '../../components/TrainingSetTags';
import { AccountRecoveryButton } from '../account/AccountRecoveryButton';
import { AccountApiError } from '../../lib/account-api';
import { useManagedAuth } from '../../lib/managed-auth-context';
import {
  formatTrainingQuantity,
  getSpecifiedTrainingQuantities,
  type DisplayTrainingQuantity,
} from '../../lib/training-data';
import { useOptionalWorkspace } from '../../lib/workspace-context';
import {
  consumeShareReturnMarker,
  isShareToken,
  writeShareReturnMarker,
} from '../../lib/share-return';

type ShareLoadResult =
  | {
      readonly token: string;
      readonly accountId: string | null;
      readonly status: 'ready';
      readonly snapshot: SharedMenuV1;
      readonly isSender: boolean;
    }
  | {
      readonly token: string;
      readonly accountId: string | null;
      readonly status: 'not-found' | 'unavailable';
    };

function getPreviewActivities(snapshot: SharedMenuV1) {
  const extraDurations = new Map<string, DisplayTrainingQuantity>();

  function toActivity(
    { name, quantities, additionalDuration }: SharedMenuExerciseV1,
    id: string,
    children: readonly TrainingActivity[] = [],
  ): TrainingActivity {
    if (additionalDuration !== undefined) extraDurations.set(id, additionalDuration);
    return { id, name, children, ...(quantities === undefined ? {} : { quantities }) };
  }

  const activities = snapshot.sections.map((section, index) =>
    toActivity(
      section,
      String(index),
      section.exercises.map((exercise, childIndex) =>
        toActivity(exercise, `${index}-${childIndex}`),
      ),
    ),
  );
  return { activities, extraDurations };
}

function SharedMenuContent({
  snapshot,
  children,
}: {
  readonly snapshot: SharedMenuV1;
  readonly children: ReactNode;
}) {
  const { activities, extraDurations } = getPreviewActivities(snapshot);

  return (
    <article aria-labelledby="shared-menu-name" className="dashboard-card drill-detail-content">
      <header>
        <TrainingSetTags
          trainingSet={{
            category: 'custom',
            ...(snapshot.customIntensity === undefined
              ? {}
              : { customIntensity: snapshot.customIntensity }),
          }}
          className="drill-detail-category"
          receivedViaShare
        />
        <h1 id="shared-menu-name">{snapshot.name}</h1>
        <p className="page-intro">A custom keiko menu shared with you.</p>
        {children}
      </header>
      <div className="detail-sections">
        <TrainingActivityList
          activities={activities}
          titleId="shared-menu-name"
          renderActivityAside={({ activity }) => {
            const extra = extraDurations.get(activity.id);
            const specified = getSpecifiedTrainingQuantities(activity);
            const quantities = extra === undefined ? specified : [...specified, extra];
            return quantities.length === 0 ? null : (
              <ul className="quantity-list" aria-label={`Quantities for ${activity.name}`}>
                {quantities.map((quantity) => (
                  <li key={quantity.unit}>{formatTrainingQuantity(quantity)}</li>
                ))}
              </ul>
            );
          }}
        />
      </div>
    </article>
  );
}

function SharedMenuBody({ recipient = false }: { readonly recipient?: boolean }): ReactElement {
  const { token: routeToken } = useParams();
  const token = isShareToken(routeToken) ? routeToken : null;
  const { api, identity, invalidateIdentity, startGoogleSignIn } = useManagedAuth();
  const workspace = useOptionalWorkspace();
  const recipientAccountId =
    recipient && identity.status === 'verified' ? identity.account.accountId : null;
  const [loadResult, setLoadResult] = useState<ShareLoadResult | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const signInGeneration = useRef(0);
  const [addedToken, setAddedToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (recipient) return;
    const cancelContinuation = () => {
      signInGeneration.current += 1;
      consumeShareReturnMarker();
      setSigningIn(false);
      setMessage('Sign-in was cancelled. You can keep previewing this menu and try again later.');
    };
    window.addEventListener('kendomenu:sign-in-cancelled', cancelContinuation);
    return () => {
      signInGeneration.current += 1;
      window.removeEventListener('kendomenu:sign-in-cancelled', cancelContinuation);
    };
  }, [recipient]);

  // Retire an old read before a late denial can invalidate the new account or route.
  useLayoutEffect(() => {
    if (token === null || (recipient && recipientAccountId === null)) return;
    const controller = new AbortController();
    let active = true;
    // Avoid starting an SDK token request for StrictMode’s immediately discarded effect.
    const load = Promise.resolve().then(() => {
      if (!active) return;
      return recipient && recipientAccountId !== null
        ? api
            .getSharedMenuForRecipient(recipientAccountId, token, controller.signal)
            .then((result) => {
              if (!active) return;
              const snapshot = parseSharedMenuV1(result.snapshot);
              if (snapshot === null || result.accountWorkspaceId !== recipientAccountId) {
                setLoadResult({
                  token,
                  accountId: recipientAccountId,
                  status: 'unavailable',
                });
                return;
              }
              setLoadResult({
                token,
                accountId: recipientAccountId,
                status: 'ready',
                snapshot,
                isSender: result.isSender,
              });
            })
        : api.getSharedMenu(token, controller.signal).then((result) => {
            if (!active) return;
            const snapshot = parseSharedMenuV1(result.snapshot);
            if (snapshot === null) {
              setLoadResult({ token, accountId: null, status: 'unavailable' });
              return;
            }
            setLoadResult({ token, accountId: null, status: 'ready', snapshot, isSender: false });
          });
    });
    void load.catch((error: unknown) => {
      if (!active) return;
      if (
        recipient &&
        error instanceof AccountApiError &&
        (error.status === 401 || error.code === 'ACCOUNT_WORKSPACE_MISMATCH')
      ) {
        setLoadResult(null);
        invalidateIdentity();
        return;
      }
      setLoadResult({
        token,
        accountId: recipientAccountId,
        status:
          error instanceof AccountApiError && error.status === 404 ? 'not-found' : 'unavailable',
      });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, invalidateIdentity, loadAttempt, recipient, recipientAccountId, token]);

  const currentResult =
    token !== null &&
    loadResult?.token === token &&
    (!recipient ||
      (identity.status === 'verified' && loadResult.accountId === identity.account.accountId))
      ? loadResult
      : null;
  const snapshot = currentResult?.status === 'ready' ? currentResult.snapshot : null;
  const isSender = currentResult?.status === 'ready' && currentResult.isSender;

  const continueToSignIn = async () => {
    if (signingIn) return;
    if (token === null || !writeShareReturnMarker(token)) {
      setMessage(
        'Sign-in could not remember this menu in this tab. Keep this link open and reopen it after signing in.',
      );
      return;
    }
    setSigningIn(true);
    const generation = ++signInGeneration.current;
    try {
      if (!(await startGoogleSignIn())) throw new Error('Sign-in unavailable');
    } catch {
      if (generation !== signInGeneration.current) return;
      consumeShareReturnMarker();
      setSigningIn(false);
      setMessage('Google sign-in could not be started. Please try again.');
    }
  };

  const addToDashboard = () => {
    if (
      token === null ||
      snapshot === null ||
      workspace?.canEdit !== true ||
      workspace.importSharedMenu === undefined ||
      adding ||
      addedToken === token
    )
      return;
    setAdding(true);
    try {
      workspace.importSharedMenu(snapshot, isSender);
      setAddedToken(token);
      consumeShareReturnMarker();
      setMessage('Added to your dashboard. Save to account to keep this menu.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The menu could not be added.');
    } finally {
      setAdding(false);
    }
  };

  if (recipient && identity.status !== 'verified') {
    return (
      <div className="shared-menu-page">
        <p role="status">Checking your account before loading this shared menu…</p>
      </div>
    );
  }
  if (token === null) {
    return (
      <div className="shared-menu-page">
        <h1>Shared menu unavailable</h1>
        <p>This link may be invalid or the owner’s account may have been removed.</p>
      </div>
    );
  }
  if (currentResult === null) {
    return (
      <div className="shared-menu-page">
        <p role="status">Loading shared menu…</p>
      </div>
    );
  }
  if (currentResult.status !== 'ready' || snapshot === null) {
    const retryable = currentResult.status === 'unavailable';
    return (
      <div className="shared-menu-page">
        <h1>Shared menu unavailable</h1>
        <p role="alert">
          {retryable
            ? 'The shared menu could not be loaded. Please try again.'
            : 'This link may be invalid or the owner’s account may have been removed.'}
        </p>
        {retryable ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              setLoadResult(null);
              setLoadAttempt((attempt) => attempt + 1);
            }}
          >
            Retry loading menu
          </button>
        ) : null}
        <Link className="secondary-button" to="/app">
          Back to KendoMenu
        </Link>
      </div>
    );
  }

  return (
    <div className="shared-menu-page">
      <SharedMenuContent snapshot={snapshot}>
        <div className="shared-menu-actions">
          {recipient ? (
            <button
              className="primary-button"
              type="button"
              disabled={adding || addedToken === token || workspace?.canEdit !== true}
              onClick={addToDashboard}
            >
              {addedToken === token
                ? 'Added to dashboard'
                : adding
                  ? 'Adding…'
                  : isSender
                    ? 'Add a copy to my dashboard'
                    : 'Add to my dashboard'}
            </button>
          ) : identity.status === 'verified' || identity.status === 'uninitialized' ? (
            <Link className="primary-button" to={`/app/account/shared/${token}`}>
              Continue to add this menu
            </Link>
          ) : identity.status === 'signed-out' ? (
            <button
              className="primary-button"
              type="button"
              disabled={signingIn}
              onClick={() => void continueToSignIn()}
            >
              {signingIn ? 'Opening Google…' : 'Sign in to add'}
            </button>
          ) : null}
          {message === null ? null : <p role="status">{message}</p>}
          {recipient && addedToken === token ? (
            <Link className="secondary-button" to="/app/account/dashboard">
              View dashboard
            </Link>
          ) : null}
          {!recipient && identity.status === 'unavailable' ? (
            <AccountRecoveryButton className="secondary-button" />
          ) : null}
        </div>
      </SharedMenuContent>
    </div>
  );
}

export function SharedMenuPage({
  recipient = false,
}: {
  readonly recipient?: boolean;
}): ReactElement {
  const { token } = useParams();
  return (
    <SharedMenuBody
      key={`${recipient ? 'account' : 'public'}:${token ?? ''}`}
      recipient={recipient}
    />
  );
}
