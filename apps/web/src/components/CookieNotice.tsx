import { useState } from 'react';
import { Link } from 'react-router-dom';

export function CookieNotice() {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) {
    return null;
  }

  return (
    <aside className="cookie-notice" aria-label="Cookie notice">
      <p className="cookie-notice-copy">
        KendoMenu currently uses no cookies or third-party tracking. We may add privacy-friendly
        analytics in the future. <Link to="/cookies">More information</Link>.
      </p>
      <button
        className="secondary-button cookie-notice-dismiss"
        type="button"
        onClick={() => setIsVisible(false)}
      >
        Got it
      </button>
    </aside>
  );
}
