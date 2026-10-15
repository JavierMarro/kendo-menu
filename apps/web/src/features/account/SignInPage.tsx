/** Google-only public sign-in entry; managed auth continues through the established redirect. */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { BrandLockup } from '../../components/BrandLockup';
import { SiteFooter } from '../../components/SiteFooter';
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
    <>
      <main id="main-content" className="auth-page" tabIndex={-1}>
        <a className="skip-link" href="#auth-panel">
          Skip to sign-in options
        </a>
        <section className="auth-story" aria-labelledby="auth-story-title">
          <BrandLockup className="auth-brand-lockup" />
          <h1 id="auth-story-title">Enter the dojo</h1>
        </section>
        <section id="auth-panel" className="auth-panel-region" aria-labelledby="auth-panel-title">
          <div className="auth-panel">
            <h2 id="auth-panel-title">KendoMenu</h2>
            {isChecking || isAuthenticated ? (
              <p className="auth-account-status" role="status">
                {isChecking
                  ? 'Checking your KendoMenu account…'
                  : 'Opening your KendoMenu account…'}
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
      <SiteFooter />
    </>
  );
}
