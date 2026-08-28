import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { CURATED_EXERCISE_COUNT, CURATED_TRAINING_SET_COUNT } from '../../lib/training-data';

interface FaqItem {
  readonly id: string;
  readonly question: string;
  readonly answer: ReactNode;
}

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: 'what-is-kendomenu',
    question: 'What is KendoMenu?',
    answer:
      'KendoMenu is a free web app for choosing, adapting, creating and organising keiko menus. Choose a menu, add it to your dashboard, then adjust each activity’s repetitions or duration to prepare a session. You can also record a menu practised with a visiting sensei or at a seminar, or create one from scratch, and save it on your device.',
  },
  {
    id: 'is-kendomenu-free',
    question: 'Is KendoMenu free?',
    answer:
      'Yes. KendoMenu is free to use, with no adverts or premium features. Your menus and dashboard data stay on the device you use; account-based cloud access will be available in the future.',
  },
  {
    id: 'all-experience-levels',
    question: 'Is KendoMenu useful for all experience levels?',
    answer:
      'Yes. KendoMenu is intended for all experience levels. The curated menus cover different kinds of practice, and each menu can be adapted by changing repetitions or duration to suit your dojo and training goals.',
  },
  {
    id: 'menu-sources',
    question: 'Where do the keiko menus come from?',
    answer: (
      <>
        The curated menus draw on publicly available English and Japanese language articles, filmed
        keiko sessions, and practice shared by schools, universities, dojo and experienced sensei.
        Find the full resource list{' '}
        <strong>
          <Link className="landing-faq-source-link" to="/app/sources">
            here
          </Link>
        </strong>
        .
      </>
    ),
  },
  {
    id: 'phone-and-computer',
    question: 'Can I use KendoMenu on my phone and computer?',
    answer:
      'Yes. KendoMenu is designed for desktop and mobile browsers. Depending on your browser, you may also be able to add a shortcut to your phone’s home screen.',
  },
  {
    id: 'device-sync',
    question: 'Are my menus synchronised between devices?',
    answer:
      'Not currently. Your saved menus and dashboard are tied to the device where you create them, so your computer and phone keep separate local data. Cloud synchronisation will be available in the future.',
  },
];

const LANDING_REVEAL_SELECTOR = '[data-landing-reveal]';

function useLandingScrollReveal() {
  const sectionsRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const sections = sectionsRef.current;
    if (
      sections === null ||
      typeof IntersectionObserver === 'undefined' ||
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return undefined;
    }

    const revealTargets = Array.from(
      sections.querySelectorAll<HTMLElement>(LANDING_REVEAL_SELECTOR),
    );
    const initialRevealBoundary = window.innerHeight * 0.88;

    for (const target of revealTargets) {
      const bounds = target.getBoundingClientRect();
      if (bounds.top <= initialRevealBoundary && bounds.bottom >= 0) {
        target.classList.add('is-revealed');
      }
    }

    sections.classList.add('landing-motion-ready');

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }

          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );

    const revealFocusedGroup = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const revealTarget = event.target.closest<HTMLElement>(LANDING_REVEAL_SELECTOR);
      if (revealTarget !== null && sections.contains(revealTarget)) {
        revealTarget.classList.add('is-revealed');
        observer.unobserve(revealTarget);
      }
    };

    for (const target of revealTargets) {
      if (!target.classList.contains('is-revealed')) {
        observer.observe(target);
      }
    }
    sections.addEventListener('focusin', revealFocusedGroup);

    return () => {
      observer.disconnect();
      sections.removeEventListener('focusin', revealFocusedGroup);
      sections.classList.remove('landing-motion-ready');
    };
  }, []);

  return sectionsRef;
}

export function LandingPage(): ReactElement {
  const [openFaqId, setOpenFaqId] = useState<string | null>(null);
  const sectionsRef = useLandingScrollReveal();

  return (
    <>
      <section className="landing-page" aria-labelledby="landing-page-title">
        <div className="landing-content">
          <p className="eyebrow">Kendo practice, curated for you</p>
          <h1 id="landing-page-title">Plan the keiko you need today.</h1>
          <p className="landing-intro">
            Choose from {CURATED_TRAINING_SET_COUNT} curated menus, shape the workload for your
            training and keep polishing mind, spirit and character through varied kendo practice.
          </p>
          <Link
            className="primary-button landing-cta landing-primary-action"
            to="/app/library"
            aria-label="Browse Keiko library"
          >
            BROWSE KEIKO LIBRARY HERE →
          </Link>
        </div>
      </section>

      <div ref={sectionsRef} className="landing-sections">
        <section className="landing-section landing-introduction" aria-labelledby="intro-title">
          <div className="landing-section-inner landing-introduction-grid">
            <div className="landing-section-heading">
              <h2 id="intro-title">A keiko menu for the day in front of you.</h2>
            </div>

            <div className="landing-section-copy" data-landing-reveal="left">
              <p>
                <strong>KendoMenu meets you where you are in your keiko.</strong> It is for senpai
                looking for fresh inspiration, sensei and dojo leaders planning a training session,
                and practitioners who want to adapt activities by changing repetitions or duration.
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
                      from online available kendo resources.
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
            <div className="landing-section-heading" data-landing-reveal="up">
              <h2 id="how-it-works-title">How it works</h2>
              <p>
                <strong>Choose. Adjust. Reuse.</strong> Move from a useful starting point to a
                repeatable session in three simple steps.
              </p>
            </div>

            <ol className="landing-steps" data-landing-reveal="steps">
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
                  Adjust repetitions or time for each activity to match the session you want to run.
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
            <div className="landing-library-heading" data-landing-reveal="split">
              <div className="landing-section-heading landing-reveal-right">
                <h2 id="library-story-title">A curated library with real training context.</h2>
              </div>
              <p className="landing-reveal-left">
                <strong>Carefully sourced and easy to adapt.</strong> These figures reflect the
                training sessions currently available in KendoMenu. Choose a keiko menu, add it to
                your dashboard, then adjust its repetitions or duration to suit the practice you are
                planning.
              </p>
            </div>

            <dl className="landing-stats" data-landing-reveal="stats">
              <div className="landing-stat">
                <dt>
                  <strong>CURATED KEIKO MENUS</strong>
                </dt>
                <dd>
                  <span className="landing-stat-value">{CURATED_TRAINING_SET_COUNT}</span>
                  <span className="landing-stat-note">researched menus in the library</span>
                </dd>
              </div>
              <div className="landing-stat">
                <dt>
                  <strong>A TOTAL OF</strong>
                </dt>
                <dd
                  aria-label={`${CURATED_EXERCISE_COUNT} leaf activities across all training sessions`}
                >
                  <span className="landing-stat-value">{CURATED_EXERCISE_COUNT}</span>
                  <span className="landing-stat-note">exercises across all training sessions</span>
                </dd>
              </div>
              <div className="landing-stat">
                <dt>
                  <strong>WORKLOAD</strong>
                </dt>
                <dd>
                  <span className="landing-stat-value">Adaptable</span>
                  <span className="landing-stat-note">
                    choose from moderate to high intensity menus and adjust quantities for the
                    practice you need
                  </span>
                </dd>
              </div>
            </dl>

            <div className="landing-library-details" data-landing-reveal="up">
              <div>
                <h3>Research sources</h3>
                <p>
                  English- and Japanese-language articles, filmed keiko sessions, high schools,
                  universities, police training programmes, and experienced sensei who have shared
                  how they train.
                </p>
              </div>
              <div>
                <h3>Menu contexts we include</h3>
                <p>
                  <strong>Examples include</strong> an Osaka police keiko menu, a high school menu,
                  and a Kanoya University menu.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section landing-faq" aria-labelledby="faq-title">
          <div className="landing-section-inner">
            <div className="landing-section-heading" data-landing-reveal="up">
              <h2 id="faq-title">Questions, answered.</h2>
              <p>
                <strong>Clear answers before you start honing your skills.</strong> The essentials
                for getting started with your first recorded training session.
              </p>
            </div>

            <div className="landing-faq-grid" data-landing-reveal="up">
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
            <div className="landing-final-cta-panel" data-landing-reveal="split">
              <div className="landing-final-cta-copy landing-reveal-right">
                <h2 id="final-cta-title">Your next keiko starts with a clear plan.</h2>
                <p>
                  <strong>Make today’s plan real.</strong> Choose a menu from the library, adjust it
                  and make the plan yours.
                </p>
              </div>
              <Link
                className="primary-button landing-primary-action landing-reveal-left"
                to="/app/library"
                aria-label="Record your first keiko"
              >
                RECORD YOUR FIRST KEIKO HERE →
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
