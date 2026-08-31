import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useCallback,
  type MutableRefObject,
  type FocusEvent,
  type FormEvent,
} from 'react';
import { Link, useBlocker, useNavigate } from 'react-router-dom';

import { isCustomTrainingIntensity } from '@kendo-menu/domain';

import {
  builderReducer,
  createInitialBuilderState,
  parseBuilderState,
  type BuilderErrors,
} from './builder-state';
import { useTrainingStore } from '../../lib/training-store-context';
import { useDataRouterMode } from '../../lib/router-context';

const EMPTY_BUILDER_ERRORS: BuilderErrors = {};

function getErrorTargetId(key: string): string {
  if (key === 'name') {
    return 'drill-name';
  }
  if (key.startsWith('section-')) {
    return `section-label-${key.slice('section-'.length)}`;
  }
  return key;
}

function DataRouterDirtyNavigationBlocker({
  isDirtyRef,
}: {
  readonly isDirtyRef: MutableRefObject<boolean>;
}) {
  const shouldBlock = useCallback(() => {
    if (!isDirtyRef.current) {
      return false;
    }

    return !window.confirm('You have an unsaved session draft. Leave this page and discard it?');
  }, [isDirtyRef]);

  useBlocker(shouldBlock);

  return null;
}

function DirtyNavigationBlocker({
  isDirtyRef,
}: {
  readonly isDirtyRef: MutableRefObject<boolean>;
}) {
  const isDataRouter = useDataRouterMode();

  return isDataRouter ? <DataRouterDirtyNavigationBlocker isDirtyRef={isDirtyRef} /> : null;
}

export function CreateDrillPage() {
  const [state, dispatch] = useReducer(builderReducer, undefined, createInitialBuilderState);
  const [isDirty, setIsDirty] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitRequest, setSubmitRequest] = useState(0);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitError, setSubmitError] = useState('');
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const lastFocusedSubmitRequest = useRef(0);
  const isDirtyRef = useRef(false);
  const isPointerInteractionRef = useRef(false);
  const pendingTouchedRef = useRef<Set<string>>(new Set());
  const navigate = useNavigate();
  const createCustomTrainingSet = useTrainingStore(
    (store) => store.createCustomTrainingSetAndAddToDashboard,
  );
  const parseResult = useMemo(() => parseBuilderState(state), [state]);
  const errors: BuilderErrors = parseResult.success ? EMPTY_BUILDER_ERRORS : parseResult.errors;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (submitRequest === 0 || lastFocusedSubmitRequest.current === submitRequest) {
      return;
    }

    lastFocusedSubmitRequest.current = submitRequest;
    if (submitted && Object.keys(errors).length > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [errors, submitted, submitRequest]);

  const update = (action: Parameters<typeof builderReducer>[1]) => {
    dispatch(action);
    isDirtyRef.current = true;
    setIsDirty(true);
  };

  const commitPendingTouched = () => {
    if (pendingTouchedRef.current.size === 0) {
      return;
    }

    const pendingFields = [...pendingTouchedRef.current];
    pendingTouchedRef.current.clear();
    setTouched((current) => new Set([...current, ...pendingFields]));
  };

  const markTouched = (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const fieldName = event.currentTarget.name;
    if (isPointerInteractionRef.current) {
      pendingTouchedRef.current.add(fieldName);
      return;
    }

    const pendingFields = [...pendingTouchedRef.current, fieldName];
    pendingTouchedRef.current.clear();
    setTouched((current) => new Set([...current, ...pendingFields]));
  };

  const showError = (key: string): boolean => submitted || touched.has(key);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setSubmitRequest((request) => request + 1);
    setSubmitError('');

    if (!parseResult.success) {
      return;
    }

    try {
      const input = parseResult.value;
      createCustomTrainingSet(input);
      isDirtyRef.current = false;
      setIsDirty(false);
      const navigation = navigate(`/app/dashboard?created=${encodeURIComponent(input.name)}`);
      void Promise.resolve(navigation).catch(() => {
        isDirtyRef.current = true;
        setIsDirty(true);
        setSubmitError('The session was saved, but KendoMenu could not open the dashboard.');
      });
    } catch {
      setSubmitError('The session could not be saved. Your draft is still here; try again.');
    }
  };

  return (
    <div
      className="builder-page"
      onPointerDownCapture={() => {
        isPointerInteractionRef.current = true;
      }}
      onPointerUpCapture={() => {
        isPointerInteractionRef.current = false;
      }}
      onPointerCancelCapture={() => {
        isPointerInteractionRef.current = false;
        commitPendingTouched();
      }}
      onPointerLeave={() => {
        isPointerInteractionRef.current = false;
        commitPendingTouched();
      }}
      onClick={commitPendingTouched}
    >
      <DirtyNavigationBlocker isDirtyRef={isDirtyRef} />
      <header className="page-header builder-header">
        <Link className="builder-back-link" to="/app/library">
          <span aria-hidden="true">← </span>
          Back to keiko library
        </Link>
        <div>
          <p className="eyebrow">Your own practice</p>
          <h1>Create a training session</h1>
          <p className="page-intro">
            Build a repeatable keiko session containing the activities and exercises you want to
            practise.
          </p>
        </div>
      </header>

      <form className="builder-form" onSubmit={handleSubmit} noValidate>
        {submitted && Object.keys(errors).length > 0 ? (
          <div
            ref={errorSummaryRef}
            className="error-summary"
            tabIndex={-1}
            role="alert"
            aria-labelledby="error-summary-title"
          >
            <h2 id="error-summary-title">Check the highlighted fields.</h2>
            <ul>
              {Object.entries(errors).map(([key, message]) => (
                <li key={key}>
                  <a href={`#${getErrorTargetId(key)}`}>{message}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {submitError.length > 0 ? (
          <p className="form-error" role="alert">
            {submitError}
          </p>
        ) : null}

        <section className="builder-form-section" aria-labelledby="session-details-title">
          <div className="builder-form-section-heading">
            <h2 id="session-details-title">Session details</h2>
          </div>
          <div className="builder-basic-fields">
            <div className="field-group builder-name-field">
              <label htmlFor="drill-name">Session name</label>
              <input
                id="drill-name"
                name="name"
                type="text"
                value={state.name}
                aria-invalid={showError('name') && errors['name'] !== undefined}
                aria-describedby={
                  showError('name') && errors['name'] !== undefined ? 'drill-name-error' : undefined
                }
                onBlur={markTouched}
                onChange={(event) => update({ type: 'set-name', value: event.target.value })}
              />
              {showError('name') && errors['name'] !== undefined ? (
                <span id="drill-name-error" className="form-error">
                  {errors['name']}
                </span>
              ) : null}
            </div>
            <div className="field-group builder-description-field">
              <label htmlFor="drill-description">Description (optional)</label>
              <textarea
                id="drill-description"
                name="description"
                value={state.description}
                rows={2}
                onBlur={markTouched}
                onChange={(event) => update({ type: 'set-description', value: event.target.value })}
              />
            </div>
            <div className="field-group builder-intensity-field">
              <label htmlFor="drill-intensity">Intensity (optional)</label>
              <select
                id="drill-intensity"
                name="intensity"
                value={state.customIntensity ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  update({
                    type: 'set-custom-intensity',
                    value: isCustomTrainingIntensity(value) ? value : undefined,
                  });
                }}
              >
                <option value="">No intensity tag</option>
                <option value="intense-drill">Intense session</option>
                <option value="high-intensity-drill">High intensity session</option>
              </select>
              <span className="field-hint">Choose one intensity tag for this custom session.</span>
            </div>
          </div>
        </section>

        <section className="builder-form-section" aria-labelledby="activities-title">
          <div className="builder-form-section-heading builder-activities-heading">
            <div>
              <h2 id="activities-title">Activities</h2>
              <p>Add activities and exercises in the order you plan to practise them.</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => update({ type: 'add-section' })}
            >
              Add activity
            </button>
          </div>

          <div className="builder-sections">
            {state.sections.map((section, sectionIndex) => {
              const sectionErrorKey = `section-${section.id}`;
              const activityTitleId = `activity-title-${section.id}`;
              const exercisesTitleId = `exercises-title-${section.id}`;
              return (
                <fieldset
                  className="builder-section"
                  key={section.id}
                  aria-labelledby={activityTitleId}
                >
                  <legend className="sr-only">Activity {sectionIndex + 1}</legend>
                  <div className="builder-activity-header">
                    <h3 id={activityTitleId}>Activity {sectionIndex + 1}</h3>
                    <button
                      className="text-button destructive-button"
                      type="button"
                      disabled={state.sections.length <= 1}
                      onClick={() => update({ type: 'remove-section', sectionId: section.id })}
                    >
                      Remove activity
                    </button>
                  </div>
                  <div className="field-group builder-activity-name-field">
                    <label htmlFor={`section-label-${section.id}`}>Activity name</label>
                    <input
                      id={`section-label-${section.id}`}
                      name={sectionErrorKey}
                      type="text"
                      value={section.label}
                      aria-invalid={
                        showError(sectionErrorKey) && errors[sectionErrorKey] !== undefined
                      }
                      aria-describedby={
                        showError(sectionErrorKey) && errors[sectionErrorKey] !== undefined
                          ? `${sectionErrorKey}-error`
                          : undefined
                      }
                      onBlur={markTouched}
                      onChange={(event) =>
                        update({
                          type: 'set-section-label',
                          sectionId: section.id,
                          value: event.target.value,
                        })
                      }
                    />
                    {showError(sectionErrorKey) && errors[sectionErrorKey] !== undefined ? (
                      <span id={`${sectionErrorKey}-error`} className="form-error">
                        {errors[sectionErrorKey]}
                      </span>
                    ) : null}
                  </div>

                  <fieldset className="builder-exercise-group" aria-labelledby={exercisesTitleId}>
                    <legend id={exercisesTitleId}>Exercises</legend>
                    <p className="field-hint">Measure each exercise by repetitions or duration.</p>
                    <ol className="builder-step-list">
                      {section.steps.map((step, stepIndex) => {
                        const labelErrorKey = `step-label-${step.id}`;
                        const repsErrorKey = `step-reps-${step.id}`;
                        const quantityHintId = `quantity-hint-${step.id}`;
                        const hasRepsError =
                          showError(repsErrorKey) && errors[repsErrorKey] !== undefined;
                        const quantityHint =
                          step.measurement === 'repetitions'
                            ? 'Use a whole number from 0 to 500.'
                            : `Use ${step.durationUnit}; zero and decimal values are supported.`;
                        return (
                          <li className="builder-step" key={step.id}>
                            <span className="step-number" aria-hidden="true">
                              {stepIndex + 1}
                            </span>
                            <div className="field-group builder-step-name-field">
                              <label htmlFor={`step-label-${step.id}`}>Exercise name</label>
                              <input
                                id={`step-label-${step.id}`}
                                name={labelErrorKey}
                                type="text"
                                value={step.label}
                                aria-invalid={
                                  showError(labelErrorKey) && errors[labelErrorKey] !== undefined
                                }
                                aria-describedby={
                                  showError(labelErrorKey) && errors[labelErrorKey] !== undefined
                                    ? `${labelErrorKey}-error`
                                    : undefined
                                }
                                onBlur={markTouched}
                                onChange={(event) =>
                                  update({
                                    type: 'set-step-label',
                                    stepId: step.id,
                                    value: event.target.value,
                                  })
                                }
                              />
                              {showError(labelErrorKey) && errors[labelErrorKey] !== undefined ? (
                                <span id={`${labelErrorKey}-error`} className="form-error">
                                  {errors[labelErrorKey]}
                                </span>
                              ) : null}
                            </div>
                            <div className="field-group builder-measurement-field">
                              <label htmlFor={`step-measurement-${step.id}`}>Measurement</label>
                              <select
                                id={`step-measurement-${step.id}`}
                                value={step.measurement}
                                onChange={(event) =>
                                  update({
                                    type: 'set-step-measurement',
                                    stepId: step.id,
                                    value:
                                      event.target.value === 'duration'
                                        ? 'duration'
                                        : 'repetitions',
                                  })
                                }
                              >
                                <option value="repetitions">Repetitions</option>
                                <option value="duration">Duration</option>
                              </select>
                            </div>
                            <div className="field-group builder-quantity-field">
                              <label htmlFor={`step-reps-${step.id}`}>
                                {step.measurement === 'repetitions' ? 'Repetitions' : 'Duration'}
                              </label>
                              <input
                                id={`step-reps-${step.id}`}
                                name={repsErrorKey}
                                type="number"
                                min={0}
                                max={step.measurement === 'repetitions' ? 500 : undefined}
                                step={step.measurement === 'repetitions' ? 1 : 'any'}
                                inputMode={
                                  step.measurement === 'repetitions' ? 'numeric' : 'decimal'
                                }
                                value={step.reps}
                                aria-invalid={hasRepsError}
                                aria-describedby={
                                  hasRepsError
                                    ? `${quantityHintId} ${repsErrorKey}-error`
                                    : quantityHintId
                                }
                                onBlur={markTouched}
                                onChange={(event) =>
                                  update({
                                    type: 'set-step-reps',
                                    stepId: step.id,
                                    value: event.target.value,
                                  })
                                }
                              />
                              <span id={quantityHintId} className="field-hint">
                                {quantityHint}
                              </span>
                              {hasRepsError ? (
                                <span id={`${repsErrorKey}-error`} className="form-error">
                                  {errors[repsErrorKey]}
                                </span>
                              ) : null}
                            </div>
                            {step.measurement === 'duration' ? (
                              <div className="field-group builder-duration-unit-field">
                                <label htmlFor={`step-duration-unit-${step.id}`}>
                                  Duration unit
                                </label>
                                <select
                                  id={`step-duration-unit-${step.id}`}
                                  value={step.durationUnit}
                                  onChange={(event) =>
                                    update({
                                      type: 'set-step-duration-unit',
                                      stepId: step.id,
                                      value:
                                        event.target.value === 'seconds' ? 'seconds' : 'minutes',
                                    })
                                  }
                                >
                                  <option value="minutes">Minutes</option>
                                  <option value="seconds">Seconds</option>
                                </select>
                              </div>
                            ) : (
                              <div
                                className="builder-duration-unit-placeholder"
                                aria-hidden="true"
                              />
                            )}
                            <button
                              className="text-button destructive-button"
                              type="button"
                              disabled={section.steps.length <= 1}
                              onClick={() =>
                                update({
                                  type: 'remove-step',
                                  sectionId: section.id,
                                  stepId: step.id,
                                })
                              }
                            >
                              Remove exercise
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                    <button
                      className="text-button builder-add-exercise"
                      type="button"
                      onClick={() => update({ type: 'add-step', sectionId: section.id })}
                    >
                      Add exercise
                    </button>
                  </fieldset>
                </fieldset>
              );
            })}
          </div>
        </section>

        <div className="builder-actions">
          <button className="primary-button" type="submit">
            Save session to dashboard
          </button>
        </div>
      </form>
    </div>
  );
}
