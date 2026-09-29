import { Link } from 'react-router-dom';

interface CookieNoticeProps {
  readonly onDismiss: () => void;
}

export function CookieNotice({ onDismiss }: CookieNoticeProps) {
  return (
    <aside className="cookie-notice" aria-label="Cookie notice">
      <p className="cookie-notice-copy">
        When signed out, KendoMenu sends one cookie-free page count when this page first opens.{' '}
        <Link to="/cookies">More information</Link>.
      </p>
      <button className="secondary-button cookie-notice-dismiss" type="button" onClick={onDismiss}>
        Got it
      </button>
    </aside>
  );
}
