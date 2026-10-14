/**
 * Renders the isolated callback failure state for the application and development proof flows.
 * Retry is shown only when the caller still owns a retryable bootstrap.
 * Provider details stay sanitized.
 */
export function AuthCallbackFailure({
  onRetry,
  onHome,
  retryAvailable,
}: {
  readonly onRetry?: () => void;
  readonly onHome?: () => void;
  readonly retryAvailable: boolean;
}) {
  return (
    <main className="app-shell">
      <section aria-labelledby="callback-title" className="panel">
        <h1 id="callback-title">Sign-in could not be completed</h1>
        <p role="status">
          The managed sign-in response could not be verified. Your account has not been opened.
        </p>
        <div className="button-row">
          {retryAvailable && onRetry !== undefined ? (
            <button className="button button-primary" onClick={onRetry} type="button">
              Retry sign-in
            </button>
          ) : null}
          <a className="button button-secondary" href="/app" onClick={onHome}>
            Return home
          </a>
        </div>
      </section>
    </main>
  );
}
