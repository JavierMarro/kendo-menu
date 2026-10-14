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
            Guest use does not require account cookies. If you choose Google sign-in, Neon Auth uses
            essential cookies for the sign-in flow and your managed session. These are functional
            cookies, rather than KendoMenu advertising or tracking cookies. KendoMenu retrieves a
            temporary token in memory to authorize account requests; it does not store credentials
            in LocalStorage, SessionStorage or IndexedDB. Google and Neon handle their own sign-in
            services under their respective privacy policies. Blocking managed session cookies can
            prevent account sign-in while guest use remains available.
          </p>
        </section>

        <section className="policy-section" aria-labelledby="local-storage-title">
          <h2 id="local-storage-title">Local storage</h2>
          <p>
            Guest dashboard training sessions are stored locally in your browser. Signing in does
            not upload or change them. If a newly created account offers to copy your guest menus,
            only choosing Copy menus sends an independent copy to the account; the original guest
            data remains on this device. Later guest and account edits are separate.
          </p>
          <p>
            Saved account menus are stored online in KendoMenu’s PostgreSQL database. Account edits
            stay in this tab’s memory until you choose Save to account and it is confirmed.
            Reloading or closing the tab can lose unsaved account changes. Signing out hides account
            content and releases this tab’s account draft; it does not delete your saved online
            menus. Existing legacy account caches are ignored without deleting them.
          </p>
          <p>
            Small device-only preferences, including notice acknowledgements and installation prompt
            state, are stored locally. A short-lived sign-in marker in session storage records only
            the fixed login flow and expiry; it contains no credentials, identity or training data.
            Clearing site storage can remove your guest menus and these preferences, so keep a
            backup of guest data you want to retain.
          </p>
        </section>

        <section className="policy-section" aria-labelledby="analytics-title">
          <h2 id="analytics-title">Analytics</h2>
          <p>
            KendoMenu sends one page count after the browser verifies that the visitor is signed
            out. The request uses GoatCounter’s image endpoint; its only query parameter is a
            static, allow-listed page path. It omits query strings, referrer information, account
            state, email, menu content, notes, and other page parameters. As with ordinary web
            requests, the service receives network metadata such as the browser’s IP address and
            user-agent. No analytics request is sent while session verification is unresolved,
            offline, or authenticated. KendoMenu does not load GoatCounter JavaScript. The request
            uses an explicit no-referrer policy and a cookie-free image GET.
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
            If you have questions, please contact the KendoMenu maintainers through the project
            repository.
          </p>
        </section>
      </div>
    </article>
  );
}
