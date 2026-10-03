import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import type { AdoptionWorkspaceState } from '../../lib/account-workspace';

export interface AdoptionDialogProps {
  readonly state: AdoptionWorkspaceState;
  readonly onChoose: (decision: 'yes' | 'no') => void;
  readonly onRetry: () => void;
}

function restoreAttribute(element: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value);
  }
}

export function AdoptionDialog({ state, onChoose, onRetry }: AdoptionDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const count = state.status === 'offer' ? state.entryCount : null;
  const retry = state.status === 'retryable' && state.decision !== undefined;
  const inProgress = state.status === 'submitting';

  useEffect(() => {
    const applicationRoot =
      document.getElementById('root') ?? document.querySelector('.app-shell')?.parentElement;
    if (applicationRoot === null || applicationRoot === undefined) return undefined;
    const previousInert = applicationRoot.getAttribute('inert');
    const previousAriaHidden = applicationRoot.getAttribute('aria-hidden');
    applicationRoot.setAttribute('inert', '');
    applicationRoot.setAttribute('aria-hidden', 'true');
    return () => {
      restoreAttribute(applicationRoot, 'inert', previousInert);
      restoreAttribute(applicationRoot, 'aria-hidden', previousAriaHidden);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const focusTarget = retry ? retryRef.current : inProgress ? dialog : yesRef.current;
    (focusTarget ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      const first = controls[0];
      const last = controls.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      if (document.activeElement === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) {
        (retry ? retryRef.current : inProgress ? dialog : yesRef.current)?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, [inProgress, retry]);

  if (
    state.status !== 'offer' &&
    state.status !== 'submitting' &&
    !(state.status === 'retryable' && state.decision !== undefined)
  ) {
    return null;
  }

  return createPortal(
    <div
      className="adoption-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <div
        className="adoption-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adoption-dialog-title"
        aria-describedby="adoption-dialog-description"
        ref={dialogRef}
        tabIndex={-1}
      >
        <p className="eyebrow">One-time account choice</p>
        <h1 id="adoption-dialog-title">Copy your guest menus to your account</h1>
        <div id="adoption-dialog-description">
          {count === null ? null : <p>Your guest dashboard has {count} entries.</p>}
          <p>
            The guest copy stays on this device. Future changes to the two dashboards stay separate.
          </p>
          <p>No is permanent. You will not be asked again for this account.</p>
        </div>
        {inProgress ? (
          <p role="status" aria-live="polite">
            Saving your choice…
          </p>
        ) : null}
        {retry ? (
          <p role="alert" aria-live="assertive">
            KendoMenu could not confirm this decision yet. Your choice is saved for recovery; retry
            to finish it.
          </p>
        ) : null}
        {count !== null ? (
          <div className="adoption-dialog-actions">
            <button
              ref={yesRef}
              className="primary-button"
              type="button"
              disabled={inProgress}
              onClick={() => onChoose('yes')}
            >
              Yes, copy menus
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={inProgress}
              onClick={() => onChoose('no')}
            >
              No, keep dashboards separate
            </button>
          </div>
        ) : retry ? (
          <button ref={retryRef} className="primary-button" type="button" onClick={onRetry}>
            Retry saved choice
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
