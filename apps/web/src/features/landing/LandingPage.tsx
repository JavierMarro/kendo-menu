/**
 * Presents the public entry point for guest planning and managed Google sign-in, alongside the
 * curated-library overview. Scroll reveals are optional presentation behavior and are skipped
 * when reduced motion is requested or the browser lacks the observer API.
 */
import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { TrainingSetTags } from '../../components/TrainingSetTags';
import { useManagedAuth } from '../../lib/managed-auth-context';
import {
  CURATED_EXERCISE_COUNT,
  CURATED_TRAINING_SET_COUNT,
  findTrainingSet,
  getBrowsableTrainingSets,
  getTrainingSetActivityCount,
  getTrainingSetDescription,
} from '../../lib/training-data';
import { useInstallLandingEntry } from '../install/install-context';

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
      'KendoMenu is a free web app for choosing, adapting, creating and organising keiko menus. Choose a menu and adjust each activity’s repetitions or duration, or create your own. Keep a journal of sessions you have practised, such as keiko with a visiting sensei or at a seminar.',
  },
  {
    id: 'is-kendomenu-free',
    question: 'Is KendoMenu free?',
    answer:
      'Yes. KendoMenu is 100% free to use as a guest or with an account, with no premium features now or in the future. We do not place adverts on the site, but embedded YouTube videos may show adverts.',
  },
  {
    id: 'all-experience-levels',
    question: 'Is KendoMenu useful for all experience levels?',
    answer: (
      <>
        Yes. KendoMenu is intended for all experience levels. The curated menus cover different
        kinds of practice, and each plan can be adapted by changing repetitions or duration to suit
        your dojo and training goals. For beginners and experienced practitioners alike, check out
        the{' '}
        <Link className="landing-faq-source-link" to="/app/glossary">
          Glossary
        </Link>{' '}
        for a quick refresher on the terms used in the menus.
      </>
    ),
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
      'Yes. Use KendoMenu in a phone or computer browser. Guest dashboards are saved on the device where you use KendoMenu; account dashboards can be opened on other devices after you select Save to account. Depending on your browser, you can also add the app to your phone’s home screen as a PWA (Progressive Web App).',
  },
  {
    id: 'open-source',
    question: 'Is KendoMenu open source?',
    answer: (
      <>
        Yes. KendoMenu is open source under the AGPL-3.0 license. The full source code lives at{' '}
        <a className="landing-faq-source-link" href="https://github.com/JavierMarro/kendo-menu">
          https://github.com/JavierMarro/kendo-menu
        </a>
        . The product is free, with no ads or premium tier, and is built by a solo developer.
      </>
    ),
  },
];

const LANDING_REVEAL_SELECTOR = '[data-landing-reveal]';
const LANDING_TEASER_IDS = [
  'international-dojo-2-hour-session',
  'university-high-school',
  'university-version-2',
] as const;
const LANDING_TEASERS = LANDING_TEASER_IDS.flatMap((trainingSetId) => {
  const trainingSet = findTrainingSet(getBrowsableTrainingSets(), trainingSetId);
  return trainingSet === undefined ? [] : [trainingSet];
});

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
    const isNarrowPhoneViewport = window.matchMedia('(max-width: 640px)').matches;
    const initialRevealBoundary = window.innerHeight * (isNarrowPhoneViewport ? 0.72 : 0.88);

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
      isNarrowPhoneViewport
        ? { rootMargin: '0px 0px -28% 0px', threshold: 0.04 }
        : { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
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
  useInstallLandingEntry();
  const { identity } = useManagedAuth();
  const isVerified = identity.status === 'verified';
  const [openFaqId, setOpenFaqId] = useState<string | null>(null);
  const sectionsRef = useLandingScrollReveal();

  return (
    <>
      <section className="landing-page" aria-labelledby="landing-page-title">
        <picture className="landing-hero" aria-hidden="true">
          <source
            type="image/avif"
            srcSet="/assets/kendo-menu-hero-768.avif 768w, /assets/kendo-menu-hero-1280.avif 1280w, /assets/kendo-menu-hero-1920.avif 1920w, /assets/kendo-menu-hero-2752.avif 2752w"
            sizes="(max-width: 679px) 200vw, (max-width: 960px) max(100vw, 941px), max(100vw, calc(179.167dvh - 129px))"
          />
          <source
            type="image/webp"
            srcSet="/assets/kendo-menu-hero-768.webp 768w, /assets/kendo-menu-hero-1280.webp 1280w, /assets/kendo-menu-hero-1920.webp 1920w, /assets/kendo-menu-hero-2752.webp 2752w"
            sizes="(max-width: 679px) 200vw, (max-width: 960px) max(100vw, 941px), max(100vw, calc(179.167dvh - 129px))"
          />
          <img
            src="/assets/kendo-menu-hero-1280.jpeg"
            srcSet="/assets/kendo-menu-hero-768.jpeg 768w, /assets/kendo-menu-hero-1280.jpeg 1280w, /assets/kendo-menu-hero-1920.jpeg 1920w, /assets/kendo-menu-hero-2752.jpeg 2752w"
            sizes="(max-width: 679px) 200vw, (max-width: 960px) max(100vw, 941px), max(100vw, calc(179.167dvh - 129px))"
            alt=""
            width="2752"
            height="1536"
            loading="eager"
            fetchPriority="high"
          />
        </picture>
        <div className="landing-content">
          <p className="eyebrow">Kendo practice, curated for you</p>
          <h1 id="landing-page-title">Plan the keiko you need today</h1>
          <p className="landing-intro">
            Choose from {CURATED_TRAINING_SET_COUNT} curated menus, shape the workload for your
            training and keep polishing mind, spirit and character through varied kendo practice
          </p>
          <div className="landing-entry-actions">
            {isVerified ? (
              <Link
                className="primary-button landing-cta landing-primary-action"
                to="/app/account/dashboard"
              >
                Back to your dashboard
              </Link>
            ) : (
              <>
                <Link
                  className="primary-button landing-cta landing-primary-action"
                  to="/app/guest/dashboard"
                >
                  Try without an account
                </Link>
                <Link className="secondary-button landing-cta" to="/app/sign-in">
                  Sign up here
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <div ref={sectionsRef} className="landing-sections">
        <section className="landing-section landing-introduction" aria-labelledby="intro-title">
          <div className="landing-section-inner">
            <div className="landing-introduction-grid">
              <div className="landing-section-heading">
                <h2 id="intro-title">A keiko menu for the day in front of you</h2>
              </div>

              <div className="landing-section-copy" data-landing-reveal="left">
                <p>
                  <strong>KendoMenu meets you where you are in your kendo journey.</strong> It is
                  for senpai looking for fresh inspiration, sensei planning keiko, or practitioners
                  who want to keep a journal of their training sessions.
                </p>
                <p>
                  <strong>Start with a curated practice plan or build from scratch.</strong> Shape
                  it around the people, time, and goals in front of you.
                </p>
              </div>
            </div>

            <section
              className="landing-menu-preview"
              aria-labelledby="landing-menu-preview-title"
              data-landing-reveal="up"
            >
              <h3 id="landing-menu-preview-title">Explore a few curated menus</h3>
              <ul className="landing-menu-teasers">
                {LANDING_TEASERS.map((trainingSet) => (
                  <li key={trainingSet.id}>
                    <Link
                      className="landing-menu-teaser"
                      to={{
                        pathname: '/app/guest/library',
                        search: `?drill=${encodeURIComponent(trainingSet.id)}`,
                      }}
                    >
                      <TrainingSetTags trainingSet={trainingSet} />
                      <h4>{trainingSet.name}</h4>
                      <p className="landing-menu-teaser-description">
                        {getTrainingSetDescription(trainingSet) ??
                          trainingSet.activities
                            .slice(0, 4)
                            .map((activity) => activity.name)
                            .join(' · ')}
                      </p>
                      <span className="step-count">
                        {getTrainingSetActivityCount(trainingSet)} activities
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link className="landing-menu-preview-link" to="/app/guest/library">
                See all {CURATED_TRAINING_SET_COUNT} menus →
              </Link>
            </section>
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
                <p>Add the plan to your dashboard and reuse it when the next session arrives.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="landing-section landing-library" aria-labelledby="library-story-title">
          <div className="landing-section-inner">
            <div className="landing-library-heading" data-landing-reveal="split">
              <div className="landing-section-heading landing-reveal-right">
                <h2 id="library-story-title">A curated library with real training context</h2>
              </div>
              <p className="landing-reveal-left">
                <strong>Carefully sourced and easy to adapt.</strong> These figures reflect the
                training sessions currently available in KendoMenu. Choose a practice plan, add it
                to your dashboard, then adjust its repetitions or duration to suit the practice you
                are planning.
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
                <h3>Training contexts we include</h3>
                <p>
                  <strong>Examples include</strong> an Osaka police keiko menu, a high school
                  routine, and a Kanoya University training sequence.
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
                <h2 id="final-cta-title">Your next keiko starts with a clear plan</h2>
                <p>
                  <strong>Make today’s plan real.</strong> Choose a session from the library, adjust
                  it and make the plan yours.
                </p>
              </div>
              <Link
                className="primary-button landing-primary-action landing-reveal-left"
                to={isVerified ? '/app/account/dashboard' : '/app/guest/dashboard'}
                aria-label={isVerified ? undefined : 'Record your first keiko'}
              >
                {isVerified ? 'Continue to your dashboard' : 'RECORD YOUR FIRST KEIKO HERE →'}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
