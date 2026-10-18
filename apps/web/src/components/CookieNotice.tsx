/**
 * Discloses optional managed-session cookies and cookie-free analytics, delegating acknowledgement
 * to the route owner.
 * The notice does not set cookies or make persistence decisions itself.
 */
import { Link } from 'react-router-dom';

interface CookieNoticeProps {
  readonly onDismiss: () => void;
}

export function CookieNotice({ onDismiss }: CookieNoticeProps) {
  return (
    <aside className="cookie-notice" aria-label="Cookie notice">
      <p className="cookie-notice-copy">
        If you sign in with Google, essential cookies maintain your session. Analytics use no
        cookies. Videos load YouTube only when opened and may show adverts or use cookies.{' '}
        <Link to="/cookies">More information</Link>.
      </p>
      <button className="secondary-button cookie-notice-dismiss" type="button" onClick={onDismiss}>
        Got it
      </button>
    </aside>
  );
}
