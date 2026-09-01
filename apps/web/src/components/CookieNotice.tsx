import { Link } from 'react-router-dom';

interface CookieNoticeProps {
  readonly onDismiss: () => void;
}

export function CookieNotice({ onDismiss }: CookieNoticeProps) {
  return (
    <aside className="cookie-notice" aria-label="Cookie notice">
      <p className="cookie-notice-copy">
        KendoMenu does not use any tracking cookies, no training data or notes leave your device.
        KendoMenu only uses aggregate analytics through GoatCounter.{' '}
        <Link to="/cookies">More information</Link>.
      </p>
      <button className="secondary-button cookie-notice-dismiss" type="button" onClick={onDismiss}>
        Got it
      </button>
    </aside>
  );
}
