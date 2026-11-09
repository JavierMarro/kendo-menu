import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';

import { parseSharedMenuV1, type SharedMenuV1 } from '@kendo-menu/domain/menu-sharing';
import { TrainingSetTags } from '../../components/TrainingSetTags';
import { useManagedAuth } from '../../lib/managed-auth-context';
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
  | { readonly token: string; readonly accountId: string | null; readonly status: 'unavailable' };

function SharedMenuContent({ snapshot }: { readonly snapshot: SharedMenuV1 }) {
  return (
    <section aria-labelledby="shared-menu-name" className="training-detail">
      <TrainingSetTags
        trainingSet={{
          category: 'custom',
          ...(snapshot.customIntensity === undefined
            ? {}
            : { customIntensity: snapshot.customIntensity }),
        }}
        receivedViaShare
      />
      <h1 id="shared-menu-name">{snapshot.name}</h1>
      <p>A custom keiko menu shared with you.</p>
      <ol className="training-activity-list">
        {snapshot.sections.map((section, sectionIndex) => (
          <li key={`${sectionIndex}-${section.name}`}>
            <h2>{section.name}</h2>
            {section.quantities === undefined ? null : (
              <QuantitySummary
                quantities={section.quantities}
                additionalDuration={section.additionalDuration}
              />
            )}
            <ul>
              {section.exercises.map((exercise, exerciseIndex) => (
                <li key={`${exerciseIndex}-${exercise.name}`}>
                  {exercise.name}
                  {exercise.quantities === undefined ? null : (
                    <QuantitySummary
                      quantities={exercise.quantities}
                      additionalDuration={exercise.additionalDuration}
                    />
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

function QuantitySummary({
  quantities,
  additionalDuration,
}: {
  readonly quantities: NonNullable<SharedMenuV1['sections'][number]['quantities']>;
  readonly additionalDuration?: SharedMenuV1['sections'][number]['additionalDuration'];
}) {
  const parts = [
    quantities.repetitions === undefined ? null : `${quantities.repetitions} repetitions`,
    quantities.sets === undefined ? null : `${quantities.sets} sets`,
    quantities.rounds === undefined ? null : `${quantities.rounds} rounds`,
    quantities.duration === undefined
      ? null
      : 'value' in quantities.duration
        ? `${quantities.duration.value} ${quantities.duration.unit}`
        : `${quantities.duration.min}–${quantities.duration.max} ${quantities.duration.unit}`,
    additionalDuration === undefined
      ? null
      : `${additionalDuration.value} ${additionalDuration.unit}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : <p>{parts.join(' · ')}</p>;
}

function SharedMenuBody({ recipient = false }: { readonly recipient?: boolean }): ReactElement {
  const { token: routeToken } = useParams();
  const token = isShareToken(routeToken) ? routeToken : null;
  const { api, identity, startGoogleSignIn, verifyIdentity } = useManagedAuth();
  const workspace = useOptionalWorkspace();
  const recipientAccountId =
    recipient && identity.status === 'verified' ? identity.account.accountId : null;
  const [loadResult, setLoadResult] = useState<ShareLoadResult | null>(null);
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

  useEffect(() => {
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
    void load.catch(() => {
      if (active) {
        setLoadResult({
          token,
          accountId: recipientAccountId,
          status: 'unavailable',
        });
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, recipient, recipientAccountId, token]);

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
  if (currentResult.status === 'unavailable' || snapshot === null) {
    return (
      <div className="shared-menu-page">
        <h1>Shared menu unavailable</h1>
        <p>This link may be invalid or the owner’s account may have been removed.</p>
        <Link className="secondary-button" to="/app">
          Back to KendoMenu
        </Link>
      </div>
    );
  }

  return (
    <div className="shared-menu-page">
      <SharedMenuContent snapshot={snapshot} />
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
        <button className="secondary-button" type="button" onClick={() => void verifyIdentity()}>
          Retry account check
        </button>
      ) : null}
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
