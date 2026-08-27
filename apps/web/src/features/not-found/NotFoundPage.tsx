import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="empty-state" aria-labelledby="not-found-title">
      <p className="eyebrow">Page not found</p>
      <h1 id="not-found-title">That route is not part of KendoMenu.</h1>
      <p>Choose a place to continue your practice planning.</p>
      <div className="empty-actions">
        <Link className="primary-button" to="/app/dashboard">
          Go to dashboard
        </Link>
        <Link className="secondary-button" to="/app/library">
          Browse Keiko library
        </Link>
      </div>
    </section>
  );
}
