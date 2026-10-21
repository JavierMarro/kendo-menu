/** Publishes the current guest, account, sign-in, and third-party data flows as public information. */
import { Link } from 'react-router-dom';

export function PrivacyPolicyPage() {
  return (
    <article className="policy-page" aria-labelledby="privacy-policy-title">
      <header className="page-header policy-header">
        <div>
          <p className="eyebrow">Privacy and transparency</p>
          <h1 id="privacy-policy-title">Privacy Policy</h1>
          <p className="page-intro">
            What KendoMenu stores, which services it uses, and the choices available to you.
          </p>
        </div>
      </header>

      <div className="policy-sections">
        <section className="policy-section" aria-labelledby="guest-data-title">
          <h2 id="guest-data-title">Guest data on your device</h2>
          <p>
            Guest menus, including exercises, quantities and notes, stay in your browser’s
            localStorage and work offline. Signing in does not upload them. If a new account offers
            to copy guest menus, only choosing “Copy menus” uploads an independent copy; the
            originals stay on your device. A new account gets this offer once.
          </p>
          <p>
            Seen marks for Mitori room videos are a separate browser preference. They stay on this
            device, including when you are signed in, and are not synced across devices.
          </p>
        </section>

        <section className="policy-section" aria-labelledby="account-data-title">
          <h2 id="account-data-title">Account data and saved changes</h2>
          <p>
            An optional account stores your email address and saved menus in a PostgreSQL database
            so you can access them across devices. Account changes need an internet connection and
            are saved only when you choose “Save to account” and receive confirmation. Unsaved
            changes can be lost if you reload, close the tab or sign out.
          </p>
          <p>
            Vercel hosts KendoMenu. Neon provides managed authentication and the PostgreSQL database
            used for saved account menus.
          </p>
        </section>

        <section className="policy-section" aria-labelledby="google-sign-in-title">
          <h2 id="google-sign-in-title">Google sign-in</h2>
          <p>
            We receive your email address and profile name from Google, not access to your contacts,
            calendar or other Google data. Google and Neon process sign-in information under their
            own privacy terms.
          </p>
        </section>

        <section className="policy-section" aria-labelledby="cookies-analytics-title">
          <h2 id="cookies-analytics-title">Cookies, analytics, and videos</h2>
          <p>KendoMenu’s own analytics do not use cookies.</p>
          <p>
            Guest use needs no account cookies. Google sign-in uses essential cookies through Neon
            Auth to keep you signed in. Blocking them may prevent sign-in, but guest use remains
            available. KendoMenu does not store sign-in credentials in your browser’s local storage.
          </p>
          <p>
            GoatCounter receives a cookie-free page count only after you are confirmed signed out
            and online. We send a fixed page path, not your email, menus, notes, query strings or
            referrer. Like any web request, it includes network information such as your IP address
            and browser type. No count is sent while sign-in is being checked or you are signed in.
          </p>
          <p>
            Mitori room connects to YouTube only when you open a video. We use privacy-enhanced
            embeds, but YouTube receives network information and may use cookies and show adverts.
            Video playback needs an internet connection and is covered by{' '}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
              Google’s privacy policy
            </a>
            .
          </p>
          <p>
            See the <Link to="/cookies">Cookie Policy</Link> for more about sign-in cookies and
            browser choices.
          </p>
        </section>

        <section className="policy-section" aria-labelledby="deleting-data-title">
          <h2 id="deleting-data-title">Deleting your data and contact</h2>
          <p>
            Delete guest menus individually on your dashboard, or clear this site’s browser storage
            to remove all local menus and preferences. Keep a backup first if needed. To delete your
            account and its saved online data, contact the maintainer.
          </p>
          <p>
            For privacy questions or data deletion requests, contact the maintainer through the{' '}
            <a href="https://github.com/JavierMarro/kendo-menu">project repository</a>. Issues are
            public: do not include private information; ask for a private contact method when
            needed.
          </p>
        </section>
      </div>
    </article>
  );
}
