import { Component, useEffect, useRef, useState, type ReactNode } from 'react';

import { copyErrorDiagnostics } from '../../lib/error-diagnostics';

interface AppErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onRecovery?: () => void;
  readonly onReload?: () => void;
}

interface AppErrorBoundaryState {
  readonly failed: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    // Deliberately retain no exception, message, or component stack.
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? (
      <AppErrorFallback onRecovery={this.props.onRecovery} onReload={this.props.onReload} />
    ) : (
      this.props.children
    );
  }
}

function AppErrorFallback({
  onRecovery,
  onReload,
}: {
  readonly onRecovery: (() => void) | undefined;
  readonly onReload: (() => void) | undefined;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const [actionFailed, setActionFailed] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function copyDiagnostics(): Promise<void> {
    setCopyStatus('copying');
    try {
      await copyErrorDiagnostics(onRecovery !== undefined);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  function runAction(action: () => void): void {
    try {
      action();
    } catch {
      setActionFailed(true);
    }
  }

  return (
    <main className="recovery-page" aria-labelledby="app-error-title">
      <meta name="robots" content="noindex, nofollow" />
      <section className="recovery-card">
        <h1 id="app-error-title" ref={headingRef} tabIndex={-1}>
          KendoMenu couldn’t continue.
        </h1>
        <p>
          Something went wrong while showing the app. You can reload to try again. Unsaved changes
          will be lost on reload.
        </p>
        {onRecovery !== undefined ? (
          <p>
            Open data recovery to check your saved data and back up unsaved changes when available.
          </p>
        ) : null}
        <div className="recovery-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => runAction(onReload ?? (() => window.location.reload()))}
          >
            Reload KendoMenu
          </button>
          {onRecovery !== undefined ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => runAction(onRecovery)}
            >
              Open data recovery
            </button>
          ) : null}
          <button
            className="secondary-button"
            type="button"
            disabled={copyStatus === 'copying'}
            onClick={() => void copyDiagnostics()}
          >
            Copy diagnostics
          </button>
        </div>
        <p>Diagnostics contain only an error code and whether data recovery is available.</p>
        <p role="status">{copyStatus === 'copied' ? 'Diagnostics copied.' : ''}</p>
        {copyStatus === 'failed' ? (
          <p className="form-error" role="alert">
            Diagnostics could not be copied. You can try again.
          </p>
        ) : null}
        {actionFailed ? (
          <p className="form-error" role="alert">
            That action could not be completed. Try again or reload using your browser.
          </p>
        ) : null}
      </section>
    </main>
  );
}
