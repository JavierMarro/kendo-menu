export function CookiePolicyPage() {
  return (
    <article className="policy-page" aria-labelledby="cookie-policy-title">
      <header className="page-header policy-header">
        <div>
          <p className="eyebrow">Privacy and transparency</p>
          <h1 id="cookie-policy-title">Cookie Policy</h1>
          <p className="page-intro">
            A clear explanation of how KendoMenu handles cookies, local data, and future analytics.
          </p>
        </div>
      </header>

      <div className="policy-sections">
        <section className="policy-section" aria-labelledby="what-are-cookies-title">
          <h2 id="what-are-cookies-title">What are cookies?</h2>
          <p>
            Cookies are small text files that websites can save in your browser to remember
            information between visits. They can support essential functionality, remember
            preferences, or used for analytics or advertising.
          </p>
        </section>

        <section className="policy-section" aria-labelledby="how-kendo-menu-uses-cookies-title">
          <h2 id="how-kendo-menu-uses-cookies-title">How KendoMenu uses cookies</h2>
          <p>
            <b>KendoMenu does not use analytics, advertising, or tracking cookies.</b>
          </p>
        </section>

        <section className="policy-section" aria-labelledby="local-storage-title">
          <h2 id="local-storage-title">Local storage</h2>
          <p>
            Your dashboard training sessions are stored locally in your browser so KendoMenu can
            work without an account or a server. This training data is separate from cookies, is not
            sent to a remote service and can be deleted by clearing site data in your browser.
          </p>
        </section>

        <section className="policy-section" aria-labelledby="future-analytics-title">
          <h2 id="future-analytics-title">Analytics</h2>
          <p>
            KendoMenu does not currently include analytics. If privacy-friendly Plausible Analytics
            is added in the future, this policy will be updated before it is enabled.
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
