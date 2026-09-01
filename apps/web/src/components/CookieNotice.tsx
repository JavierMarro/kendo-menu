import { Link } from 'react-router-dom';

interface CookieNoticeProps {
  readonly onDismiss: () => void;
}

export function CookieNotice({ onDismiss }: CookieNoticeProps) {
  return (
    <aside className="cookie-notice" aria-label="Cookie notice">
      <p className="cookie-notice-copy">
        This site does not use tracking cookies. We use GoatCounter Analytics (no cookies) to
        improve the service. <Link to="/cookies">More information</Link>.
      </p>
      <button className="secondary-button cookie-notice-dismiss" type="button" onClick={onDismiss}>
        Got it
      </button>
    </aside>
  );
}
