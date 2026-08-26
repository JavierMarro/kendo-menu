import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

interface FaqItem {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: 'what-is-kendomenu',
    question: 'What is KendoMenu?',
    answer:
      'KendoMenu is a free web app for choosing, adapting, creating and organising keiko menus. Adjust repetitions or time for each exercise in a chosen menu, then add it to your dashboard to prepare a session or share it with your dojo. Alternatively, have you recently had a visiting sensei or have you attended a seminar and want to record the menu practised? Create a new menu and save it to your device.',
  },
  {
    id: 'is-kendomenu-free',
    question: 'Is KendoMenu free?',
    answer:
      'Yes. KendoMenu is free to use, with no ads or premium features. For now, your menus and dashboard data stay on the device you use; account-based cloud access is a feature to be added in the future.',
  },
  {
    id: 'all-experience-levels',
    question: 'Is KendoMenu useful for all experience levels?',
    answer:
      'Yes. KendoMenu is intended for all experience levels. Curated menus will cover a range of intensities, and every menu can be adapted by changing repetitions or duration to suit your dojo and training goals.',
  },
  {
    id: 'menu-sources',
    question: 'Where do the keiko menus come from?',
    answer:
      'The planned menus are being collated from publicly available kendo resources: English and Japanese language blogs, YouTube keiko sessions, high schools, universities, police training programmes, and experienced sensei who have shared how they train. Find here the freely online available resource list.',
  },
  {
    id: 'phone-and-computer',
    question: 'Can I use KendoMenu on my phone and computer?',
    answer:
      'KendoMenu is designed as a progressive web app experience for desktop and mobile devices. If your browser offers an installation prompt, you may be able to add it to your phone.',
  },
  {
    id: 'device-sync',
    question: 'Are my menus synchronised between devices?',
    answer:
      'Not currently. Your saved menus and dashboard are tied to the device where you create them, so your computer and phone keep separate local data. Cloud synchronisation is part of the roadmap and will be added in the future.',
  },
];

export function LandingPage(): ReactElement {
  const [openFaqId, setOpenFaqId] = useState<string | null>('what-is-kendomenu');

  return (
    <>
      <section className="landing-page" aria-labelledby="landing-page-title">
        <div className="landing-content">
          <p className="eyebrow">Kendo practice, curated for you</p>
          <h1 id="landing-page-title">Plan the keiko you need today.</h1>
          <p className="landing-intro">
            Build a kendo session choosing from the 11 menus available in our library and keep
            polishing the mind, spirit, and character with different intensity kendo menus.
          </p>
          <Link className="primary-button landing-cta" to="/app/library">
            Browse drill library
          </Link>
        </div>
      </section>

      <div className="landing-sections">
        <section className="landing-section landing-introduction" aria-labelledby="intro-title">
          <div className="landing-section-inner landing-introduction-grid">
            <div className="landing-section-heading">
              <h2 id="intro-title">A keiko menu for the day in front of you.</h2>
            </div>

            <div className="landing-section-copy">
              <p>
                <strong>KendoMenu meets you where your keiko is.</strong> It is for senpai looking
                for fresh inspiration, sensei and dojo leaders who want to create and share a
                training session, and practitioners who need to adapt exercises by changing
                repetitions or duration.
              </p>
              <p>
                <strong>Start with a curated menu or build from scratch.</strong> Shape it around
                the people, time, and goals in front of you.
              </p>

              <div className="landing-benefits">
                <h3>Make the plan yours</h3>
                <ul className="landing-benefits-list">
                  <li>
                    <span>
                      <strong>Structure it quickly.</strong> Prepare a focused keiko session without
                      starting from zero.
                    </span>
                  </li>
                  <li>
                    <span>
                      <strong>Use real context.</strong> Draw on curated training ideas gathered
                      from real kendo resources.
                    </span>
                  </li>
                  <li>
                    <span>
                      <strong>Keep it close.</strong> Your created sessions stay available on this
                      device for future reference.
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section landing-process" aria-labelledby="how-it-works-title">
          <div className="landing-section-inner">
            <div className="landing-section-heading">
              <h2 id="how-it-works-title">How it works</h2>
              <p>
                <strong>Choose. Adjust. Reuse.</strong> Move from an useful starting point to a
                repeatable session in three simple steps.
              </p>
            </div>

            <ol className="landing-steps">
              <li className="landing-step">
                <span className="landing-step-number" aria-hidden="true">
                  01
                </span>
                <h3>Choose a starting point</h3>
                <p>Browse a curated keiko menu or create your own training session from scratch.</p>
              </li>
              <li className="landing-step">
                <span className="landing-step-number" aria-hidden="true">
                  02
                </span>
                <h3>Shape the workload</h3>
                <p>
                  Adjust repetitions or time for each exercise to match the session you want to run.
                </p>
              </li>
              <li className="landing-step">
                <span className="landing-step-number" aria-hidden="true">
                  03
                </span>
                <h3>Keep it ready</h3>
                <p>Add the menu to your dashboard and reuse it when the next session arrives.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="landing-section landing-library" aria-labelledby="library-story-title">
          <div className="landing-section-inner">
            <div className="landing-library-heading">
              <div className="landing-section-heading">
                <h2 id="library-story-title">A curated library with real training context.</h2>
              </div>
              <p>
                <strong>Planned, carefully sourced, and easy to expand.</strong> The catalogue is
                still being assembled. These figures are a working target for a compact, carefully
                sourced starting point—not a live count of what is currently in the app.
              </p>
            </div>

            <dl className="landing-stats">
              <div className="landing-stat">
                <dt>Curated keiko menus</dt>
                <dd>
                  <span className="landing-stat-value">11</span>
                  <span className="landing-stat-note">planned starting point</span>
                </dd>
              </div>
              <div className="landing-stat">
                <dt>Exercises in total</dt>
                <dd aria-label="Approximately 150">
                  <span className="landing-stat-value">~150</span>
                  <span className="landing-stat-note">planned across the menus</span>
                </dd>
              </div>
              <div className="landing-stat">
                <dt>Potential intensity range</dt>
                <dd>
                  <span className="landing-stat-value">Medium to high</span>
                  <span className="landing-stat-note">
                    check the labels and choose your keiko for the day
                  </span>
                </dd>
              </div>
            </dl>

            <div className="landing-library-details">
              <div>
                <h3>Planned sources</h3>
                <p>
                  English and Japanese language blogs, YouTube keiko sessions, high schools,
                  universities, police training programmes, and experienced sensei who have shared
                  how they train.
                </p>
              </div>
              <div>
                <h3>Menu contexts we include</h3>
                <p>
                  <strong>Examples include</strong> an Osaka police keiko menu, a high school menu,
                  and a Nagoya University menu.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section landing-faq" aria-labelledby="faq-title">
          <div className="landing-section-inner">
            <div className="landing-section-heading">
              <h2 id="faq-title">Questions, answered.</h2>
              <p>
                <strong>Clear answers before you plan.</strong> Everything you need to know before
                your first session.
              </p>
            </div>

            <div className="landing-faq-grid">
              {FAQ_ITEMS.map((item) => {
                const isOpen = openFaqId === item.id;
                const questionId = `${item.id}-question`;
                const answerId = `${item.id}-answer`;

                return (
                  <article className="landing-faq-item" key={item.id}>
                    <h3>
                      <button
                        id={questionId}
                        className="landing-faq-question"
                        type="button"
                        aria-controls={answerId}
                        aria-expanded={isOpen}
                        onClick={() =>
                          setOpenFaqId((currentId) => (currentId === item.id ? null : item.id))
                        }
                      >
                        <span>{item.question}</span>
                        <span className="landing-faq-indicator" aria-hidden="true" />
                      </button>
                    </h3>
                    <div
                      id={answerId}
                      className="landing-faq-answer"
                      role="region"
                      aria-labelledby={questionId}
                      hidden={!isOpen}
                    >
                      <p>{item.answer}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-section landing-final-cta" aria-labelledby="final-cta-title">
          <div className="landing-section-inner">
            <div className="landing-final-cta-panel">
              <div>
                <h2 id="final-cta-title">Your next keiko can be ready in two minutes.</h2>
                <p>
                  <strong>Make today’s plan real.</strong> Choose a menu from the library, adjust it
                  and make the plan yours.
                </p>
              </div>
              <Link className="primary-button" to="/app/library">
                Record your first keiko
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
