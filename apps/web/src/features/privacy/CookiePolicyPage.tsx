/**
 * Publishes the product's browser-storage, managed-session, and analytics disclosures as static
 * route content. Runtime privacy gates live in their owning browser integrations rather than here.
 */
export function CookiePolicyPage() {
  return (
    <article className="policy-page" aria-labelledby="cookie-policy-title">
      <header className="page-header policy-header">
        <div>
          <p className="eyebrow">Privacy and transparency</p>
          <h1 id="cookie-policy-title">Cookie Policy</h1>
          <p className="page-intro">
            A clear explanation of how KendoMenu handles cookies, local data, and aggregate
            analytics.
          </p>
        </div>
      </header>

      <div className="policy-sections">
        <section className="policy-section" aria-labelledby="what-are-cookies-title">
          <h2 id="what-are-cookies-title">What are cookies?</h2>
          <p>
            Cookies are small text files that websites can save in your browser to remember
            information between visits. They can support essential functionality, remember
            preferences, or be used for analytics or advertising.
          </p>
        </section>

        <section className="policy-section" aria-labelledby="how-kendo-menu-uses-cookies-title">
          <h2 id="how-kendo-menu-uses-cookies-title">How KendoMenu uses cookies</h2>
          <p>
            <b>KendoMenu does not use cookies for analytics, advertising, or tracking.</b>
          </p>
          <p>
            Guest use needs no account cookies. Google sign-in uses essential cookies through Neon
            Auth to keep you signed in. Blocking them may prevent sign-in, but guest use remains
            available. KendoMenu does not store sign-in credentials in your browser’s local storage.
          </p>
        </section>

        <section className="policy-section" aria-labelledby="local-storage-title">
          <h2 id="local-storage-title">Local storage</h2>
          <p>
            Guest menus, including exercises, quantities and notes, stay in your browser’s
            localStorage and work offline. Signing in does not upload them. If a new account offers
            to copy guest menus, only choosing “Copy menus” uploads an independent copy; the
            originals stay on your device.
          </p>
          <p>
            An optional account stores your email address and saved menus in a PostgreSQL database
            so you can access them across devices. Account changes need an internet connection and
            are saved only when you choose “Save to account” and receive confirmation. Unsaved
            changes can be lost if you reload, close the tab or sign out.
          </p>
          <p>
            Notice and installation preferences are also stored on this device. A temporary
            session-storage marker helps complete sign-in; it contains no credentials or menu data.
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

        <section className="policy-section" aria-labelledby="analytics-title">
          <h2 id="analytics-title">Analytics</h2>
          <p>
            GoatCounter receives a cookie-free page count only after you are confirmed signed out
            and online. We send a fixed page path, not your email, menus, notes, query strings or
            referrer. Like any web request, it includes network information such as your IP address
            and browser type. No count is sent while sign-in is being checked or you are signed in.
          </p>
          <p>
            Learn about the service from{' '}
            <strong>
              <a
                href="https://www.goatcounter.com/help/privacy"
                target="_blank"
                rel="noopener noreferrer"
              >
                GoatCounter
              </a>
            </strong>
            .
          </p>
        </section>

        <section className="policy-section" aria-labelledby="delete-data-title">
          <h2 id="delete-data-title">Deleting your data</h2>
          <p>
            Delete guest menus individually on your dashboard, or clear this site’s browser storage
            to remove all local menus and preferences. Keep a backup first if needed. To delete your
            account and its saved online data, contact the maintainer.
          </p>
        </section>

        <section className="policy-section" aria-labelledby="your-choices-title">
          <h2 id="your-choices-title">How to disable cookies?</h2>
          <p>
            You can configure your browser to block or delete cookies. KendoMenu will continue to
            work in guest mode without cookies.
          </p>
        </section>

        <section className="policy-section" aria-labelledby="contact-title">
          <h2 id="contact-title">Contact</h2>
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
