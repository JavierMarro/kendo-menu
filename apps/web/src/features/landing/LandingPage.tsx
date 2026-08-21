import { Link } from 'react-router-dom';

export function LandingPage() {
  return (
    <section className="landing-page" aria-labelledby="landing-page-title">
      <div className="landing-content">
        <p className="eyebrow">Kendo practice, shaped for today</p>
        <h1 id="landing-page-title">Plan the keiko you need today.</h1>
        <p className="landing-intro">
          Build a focused kendo session, adjust it to your day, and keep your practice moving.
        </p>
        <Link className="primary-button landing-cta" to="/app/library">
          Browse drill library
        </Link>
      </div>
    </section>
  );
}
