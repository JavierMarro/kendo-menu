/** Google-only public sign-in entry; managed auth continues through the established redirect. */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { BrandLockup } from '../../components/BrandLockup';
import { useManagedAuth } from '../../lib/managed-auth-context';

const ALTERNATIVE_SIGN_IN_MESSAGE =
  'Option to sign in with a different email provider and your own password to be implemented soon';

export function SignInPage(): ReactElement {
  const { identity, startGoogleSignIn, verifyIdentity } = useManagedAuth();
  const navigate = useNavigate();
  const [isStarting, setIsStarting] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const signInAttemptGeneration = useRef(0);

  useEffect(() => {
    if (identity.status === 'verified' || identity.status === 'uninitialized') {
      void navigate('/app/account/dashboard', { replace: true });
    }
  }, [identity.status, navigate]);

  useEffect(() => {
    const resetAttempt = () => {
      signInAttemptGeneration.current += 1;
      setIsStarting(false);
    };
    window.addEventListener('pageshow', resetAttempt);
    window.addEventListener('kendomenu:sign-in-cancelled', resetAttempt);
    return () => {
      signInAttemptGeneration.current += 1;
      window.removeEventListener('pageshow', resetAttempt);
      window.removeEventListener('kendomenu:sign-in-cancelled', resetAttempt);
    };
  }, []);

  const continueWithGoogle = async () => {
    if (isStarting) return;
    setSignInFailed(false);
    setIsStarting(true);
    const requestGeneration = ++signInAttemptGeneration.current;
    try {
      const started = await startGoogleSignIn();
      if (signInAttemptGeneration.current !== requestGeneration) return;
      if (started) return;
      setIsStarting(false);
      setSignInFailed(true);
    } catch {
      if (signInAttemptGeneration.current !== requestGeneration) return;
      setIsStarting(false);
      setSignInFailed(true);
    }
  };

  const isChecking = identity.status === 'checking';
  const isUnavailable = identity.status === 'unavailable';
  const isAuthenticated = identity.status === 'verified' || identity.status === 'uninitialized';

  return (
    <main id="main-content" className="auth-page" tabIndex={-1}>
      <a className="skip-link" href="#auth-panel">
        Skip to sign-in options
      </a>
      <section className="auth-story" aria-labelledby="auth-story-title">
        <BrandLockup className="auth-brand-lockup" />
        <h1 id="auth-story-title">Enter the dojo</h1>
      </section>
      <section id="auth-panel" className="auth-panel-region" aria-label="Sign-in options">
        <div className="auth-panel">
          {isChecking || isAuthenticated ? (
            <p className="auth-account-status" role="status">
              {isChecking ? 'Checking your KendoMenu account…' : 'Opening your KendoMenu account…'}
            </p>
          ) : isUnavailable ? (
            <div className="auth-account-status" role="status">
              <p>Account sign-in is temporarily unavailable. Guest use remains available.</p>
              <button
                className="primary-button auth-google-button"
                type="button"
                onClick={() => void verifyIdentity()}
              >
                Retry account check
              </button>
            </div>
          ) : (
            <>
              <button
                className="primary-button auth-google-button"
                type="button"
                disabled={isStarting}
                aria-busy={isStarting}
                onClick={() => void continueWithGoogle()}
              >
                <svg
                  className="auth-google-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="#4285f4"
                    d="M21.35 11.1H12v3.8h5.35a4.6 4.6 0 0 1-2 3.02v2.51h3.22c1.88-1.73 2.96-4.28 2.96-7.31 0-.68-.06-1.34-.18-2.02Z"
                  />
                  <path
                    fill="#34a853"
                    d="M12 22c2.7 0 4.96-.9 6.61-2.44l-3.22-2.51c-.9.6-2.04.96-3.39.96-2.61 0-4.82-1.76-5.61-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
                  />
                  <path
                    fill="#fbbc05"
                    d="M6.39 13.89A6 6 0 0 1 6.07 12c0-.66.11-1.3.32-1.89V7.52H3.07A10 10 0 0 0 2 12c0 1.61.38 3.13 1.07 4.48Z"
                  />
                  <path
                    fill="#ea4335"
                    d="M12 5.99c1.43 0 2.71.49 3.73 1.48l2.8-2.8A9.57 9.57 0 0 0 12 2a10 10 0 0 0-8.93 5.52l3.32 2.59C7.18 7.75 9.39 5.99 12 5.99Z"
                  />
                </svg>
                {isStarting ? 'Opening Google…' : 'Continue with Google'}
              </button>
              {signInFailed ? (
                <p className="form-error" role="alert">
                  Google sign-in could not be started. Guest use remains available.
                </p>
              ) : null}
              <div className="auth-divider" aria-hidden="true">
                <span />
                <span>or</span>
                <span />
              </div>
              <p className="auth-provider-placeholder">{ALTERNATIVE_SIGN_IN_MESSAGE}</p>
            </>
          )}
          <div className="auth-page-links">
            <Link className="secondary-button" to="/app/guest/dashboard">
              Continue as a guest
            </Link>
            <Link className="auth-home-link" to="/app">
              Back to KendoMenu home
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
