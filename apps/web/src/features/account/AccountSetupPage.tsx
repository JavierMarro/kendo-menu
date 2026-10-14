/**
 * Presents the one-time guest-copy choice from the account route's in-memory creation handoff.
 * Yes revalidates the guest source before dispatch, and every exit leaves guest storage untouched.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  type AdoptionDecisionRequest,
  type ManagedAccountInitialization,
} from '../../lib/account-api';
import {
  createGuestCopyRequest,
  guestCopyFitsRequestLimit,
  readGuestCopySnapshot,
  type GuestCopySnapshot,
} from '../../lib/account-adoption';

export interface AccountSetupContextValue {
  readonly accountId: string;
  readonly handoff: ManagedAccountInitialization | null;
  readonly revision: string;
  readonly catalogueVersion: string | null;
  readonly ready: boolean;
  readonly identityVerified: boolean;
  readonly dashboardStatus:
    'loading' | 'ready' | 'unavailable' | 'auth-hidden' | 'load-error' | 'disposed';
  readonly dashboardLoaded: boolean;
  readonly submit: (
    request: AdoptionDecisionRequest,
  ) => Promise<'accepted' | 'declined' | 'unconfirmed' | 'abandoned' | 'stale'>;
  readonly release: () => void;
  readonly reload: () => Promise<void>;
}

export const AccountSetupContext = createContext<AccountSetupContextValue | null>(null);

function useSetup(): AccountSetupContextValue {
  const value = useContext(AccountSetupContext);
  if (value === null) throw new Error('Account setup must be inside a verified account route.');
  return value;
}

type SetupPhase =
  'checking' | 'choice' | 'submitting' | 'accepted' | 'declined' | 'unconfirmed' | 'abandoned';

export function AccountSetupPage() {
  const setup = useSetup();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<SetupPhase>('checking');
  const [offered, setOffered] = useState<GuestCopySnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const mounted = useRef(false);
  const pageHidden = useRef(false);
  const choicePending = useRef(false);
  const recoveryNeeded = useRef(false);
  const recoveryPhase = useRef<'unconfirmed' | 'abandoned'>('unconfirmed');
  const latestSetup = useRef(setup);

  useLayoutEffect(() => {
    latestSetup.current = setup;
  }, [setup]);

  useEffect(() => {
    // Drop the volatile handoff on departure; do not submit a pending preflight after pagehide.
    const abandonOnPageHide = () => {
      pageHidden.current = true;
      setup.release();
      if (attempted) return;
      recoveryNeeded.current = false;
      choicePending.current = true;
      setAttempted(true);
      setPhase('abandoned');
      setMessage(
        'Setup was interrupted before your choice was sent. The one-time opportunity may be lost. Your guest menus remain on this device.',
      );
    };
    window.addEventListener('pagehide', abandonOnPageHide);
    return () => window.removeEventListener('pagehide', abandonOnPageHide);
  }, [attempted, setup]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Wait for this verified account's eligible, empty cloud dashboard before offering the handoff.
    let active = true;
    const handoff = setup.handoff;
    const catalogueVersion = setup.catalogueVersion;
    if (attempted) return;
    if (
      !setup.identityVerified ||
      setup.dashboardStatus === 'loading' ||
      setup.dashboardStatus === 'load-error' ||
      setup.dashboardStatus === 'auth-hidden' ||
      setup.dashboardStatus === 'disposed'
    )
      return;
    const skip = () => {
      setup.release();
      void navigate('/app/account/dashboard', { replace: true });
    };
    if (!setup.ready || handoff === null || setup.revision !== '0' || catalogueVersion === null) {
      skip();
      return () => {
        active = false;
      };
    }
    void readGuestCopySnapshot().then((snapshot) => {
      if (!active) return;
      if (
        snapshot === null ||
        !guestCopyFitsRequestLimit({
          accountId: setup.accountId,
          handoff,
          catalogueVersion,
          snapshot,
        })
      ) {
        skip();
        return;
      }
      setOffered(snapshot);
      setPhase('choice');
    });
    return () => {
      active = false;
    };
  }, [
    navigate,
    setup.accountId,
    setup.catalogueVersion,
    setup.dashboardStatus,
    setup.handoff,
    setup.identityVerified,
    setup.ready,
    setup.release,
    setup.revision,
    setup,
    attempted,
  ]);

  useEffect(() => {
    if (!recoveryNeeded.current || !setup.ready || setup.handoff !== null) return;
    recoveryNeeded.current = false;
    void setup.reload().then(() => {
      if (!mounted.current) return;
      setAttempted(true);
      setPhase(recoveryPhase.current);
      setMessage(
        recoveryPhase.current === 'abandoned'
          ? 'Your choice was not sent because account identity changed during setup. The one-time opportunity may be lost. Your guest menus remain on this device.'
          : 'We could not confirm whether your choice completed. The one-time opportunity may be lost. Your guest menus remain on this device.',
      );
    });
  }, [setup, setup.handoff, setup.ready, setup.reload]);

  async function choose(decision: 'yes' | 'no'): Promise<void> {
    const handoff = setup.handoff;
    const catalogueVersion = setup.catalogueVersion;
    if (
      phase !== 'choice' ||
      handoff === null ||
      handoff.copyOpportunityId === undefined ||
      catalogueVersion === null ||
      choicePending.current
    )
      return;
    choicePending.current = true;
    setPhase('submitting');
    setMessage('Checking your guest menus…');
    let request: AdoptionDecisionRequest;
    if (decision === 'yes') {
      // The offer is only a preview: compare exact source bytes again immediately before dispatch.
      const current = await readGuestCopySnapshot();
      if (!mounted.current) return;
      if (pageHidden.current) return;
      if (
        !latestSetup.current.ready ||
        latestSetup.current.handoff !== handoff ||
        latestSetup.current.revision !== '0' ||
        latestSetup.current.catalogueVersion !== catalogueVersion
      ) {
        if (!mounted.current) return;
        setup.release();
        recoveryPhase.current = 'abandoned';
        recoveryNeeded.current = true;
        setAttempted(true);
        return;
      }
      if (current === null) {
        setup.release();
        setMessage('Guest menus could not be read, so no copy request was sent.');
        void navigate('/app/account/dashboard', { replace: true });
        return;
      }
      if (current.raw !== offered?.raw) {
        if (
          !guestCopyFitsRequestLimit({
            accountId: setup.accountId,
            handoff,
            catalogueVersion,
            snapshot: current,
          })
        ) {
          setup.release();
          setMessage('The changed guest menus exceed the copy limit. No copy request was sent.');
          void navigate('/app/account/dashboard', { replace: true });
          return;
        }
        setOffered(current);
        setPhase('choice');
        setMessage('Guest menus changed. Review the updated offer before choosing.');
        choicePending.current = false;
        return;
      }
      const copy = createGuestCopyRequest({
        accountId: setup.accountId,
        handoff,
        catalogueVersion,
        snapshot: current,
        requestId: crypto.randomUUID(),
      });
      if (copy === null) {
        setup.release();
        setMessage('The guest menus could not be prepared for copying. No request was sent.');
        void navigate('/app/account/dashboard', { replace: true });
        return;
      }
      request = copy;
    } else {
      request = {
        transportVersion: 1,
        decision: 'no',
        expectedAccountWorkspaceId: setup.accountId,
        copyOpportunityId: handoff.copyOpportunityId,
        requestId: crypto.randomUUID(),
      };
    }
    setAttempted(true);
    // The controller owns one-use handoff release and never replays an adoption decision.
    const outcome = await setup.submit(request);
    if (!mounted.current) return;
    if (outcome === 'stale') {
      recoveryPhase.current = 'unconfirmed';
      recoveryNeeded.current = true;
      return;
    }
    if (outcome === 'abandoned') {
      recoveryPhase.current = 'abandoned';
      recoveryNeeded.current = true;
      return;
    }
    setPhase(outcome);
    setMessage(
      outcome === 'accepted'
        ? 'Your guest menus were copied to your account.'
        : outcome === 'declined'
          ? 'You chose not to copy your guest menus.'
          : 'We could not confirm whether your choice completed. The one-time opportunity may be lost. Your guest menus remain on this device.',
    );
  }

  const dashboardLoaded = setup.dashboardLoaded;
  const entryCount = offered?.entryCount ?? 0;
  if (phase === 'checking') {
    return (
      <section className="account-route-state" role="status" aria-live="polite">
        <h1>Checking your guest menus…</h1>
      </section>
    );
  }
  if (phase === 'submitting') {
    return (
      <section className="account-route-state" role="status" aria-live="polite">
        <h1>Sending your choice…</h1>
        <p>{message}</p>
      </section>
    );
  }
  // After a decision attempt, retry only the authoritative dashboard load, never the one-use choice.
  if (attempted && !dashboardLoaded) {
    return (
      <section className="account-route-state" role="alert" aria-live="polite">
        <h1>Your account dashboard could not be loaded.</h1>
        <p>{message}</p>
        <p>{setup.handoff === null ? 'Your one-time copy choice cannot be retried.' : null}</p>
        <button className="primary-button" type="button" onClick={() => void setup.reload()}>
          Retry dashboard load
        </button>
      </section>
    );
  }
  if (
    phase === 'accepted' ||
    phase === 'declined' ||
    phase === 'unconfirmed' ||
    phase === 'abandoned'
  ) {
    return (
      <section
        className="account-route-state"
        role={phase === 'unconfirmed' || phase === 'abandoned' ? 'alert' : 'status'}
      >
        <h1>
          {phase === 'accepted'
            ? 'Guest menus copied'
            : phase === 'declined'
              ? 'Choice confirmed'
              : phase === 'abandoned'
                ? 'Setup interrupted'
                : 'Choice not confirmed'}
        </h1>
        <p aria-live="polite">{message}</p>
        <button
          className="primary-button"
          type="button"
          onClick={() => void navigate('/app/account/dashboard', { replace: true })}
        >
          Continue to account
        </button>
      </section>
    );
  }
  return (
    <section className="account-route-state">
      <h1>Copy your guest menus to your account?</h1>
      <p>
        {entryCount} menu {entryCount === 1 ? 'entry' : 'entries'} are ready to copy.
      </p>
      <ul>
        <li>Yes creates an independent online copy.</li>
        <li>Your guest menus remain on this device.</li>
        <li>Later guest and account edits are separate.</li>
        <li>No permanently declines this one-time opportunity.</li>
        <li>An interruption may lose the opportunity.</li>
      </ul>
      {message !== null ? (
        <p role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      <div className="empty-actions">
        <button className="primary-button" type="button" onClick={() => void choose('yes')}>
          Copy menus
        </button>
        <button className="secondary-button" type="button" onClick={() => void choose('no')}>
          No, thanks
        </button>
      </div>
    </section>
  );
}
