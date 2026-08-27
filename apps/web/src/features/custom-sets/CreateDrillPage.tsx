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

import {
  builderReducer,
  createInitialBuilderState,
  toTrainingSetInput,
  validateBuilderState,
} from './builder-state';
import { useTrainingStore } from '../../lib/training-store-context';
import { useDataRouterMode } from '../../lib/router-context';

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
  const navigate = useNavigate();
  const createCustomTrainingSet = useTrainingStore(
    (store) => store.createCustomTrainingSetAndAddToDashboard,
  );
  const errors = useMemo(() => validateBuilderState(state), [state]);

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

  const markTouched = (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const fieldName = event.currentTarget.name;
    setTouched((current) => new Set([...current, fieldName]));
  };

  const showError = (key: string): boolean => submitted || touched.has(key);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setSubmitRequest((request) => request + 1);
    setSubmitError('');

    if (Object.keys(errors).length > 0) {
      return;
    }

    try {
      const input = toTrainingSetInput(state);
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
    <>
      <DirtyNavigationBlocker isDirtyRef={isDirtyRef} />
      <header className="page-header builder-header">
        <div>
          <p className="eyebrow">Your own practice</p>
          <h1>Create a training session</h1>
          <p className="page-intro">
            Build a repeatable keiko session containing the sections and exercises you want to
            practise.
          </p>
        </div>
        <Link className="text-button" to="/app/library">
          Back to Keiko library
        </Link>
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

        <div className="builder-basic-fields">
          <div className="field-group">
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
          <div className="field-group">
            <label htmlFor="drill-description">Description (optional)</label>
            <textarea
              id="drill-description"
              name="description"
              value={state.description}
              rows={3}
              onBlur={markTouched}
              onChange={(event) => update({ type: 'set-description', value: event.target.value })}
            />
          </div>
        </div>

        <div className="builder-sections">
          {state.sections.map((section, sectionIndex) => {
            const sectionErrorKey = `section-${section.id}`;
            return (
              <fieldset className="builder-section" key={section.id}>
                <legend>
                  Exercise {sectionIndex + 1}
                  <button
                    className="text-button destructive-button"
                    type="button"
                    disabled={state.sections.length <= 1}
                    onClick={() => update({ type: 'remove-section', sectionId: section.id })}
                  >
                    Remove exercise
                  </button>
                </legend>
                <div className="field-group">
                  <label htmlFor={`section-label-${section.id}`}>Exercise name</label>
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

                <ol className="builder-step-list">
                  {section.steps.map((step, stepIndex) => {
                    const labelErrorKey = `step-label-${step.id}`;
                    const repsErrorKey = `step-reps-${step.id}`;
                    return (
                      <li className="builder-step" key={step.id}>
                        <span className="step-number" aria-hidden="true">
                          {stepIndex + 1}
                        </span>
                        <div className="field-group">
                          <label htmlFor={`step-label-${step.id}`}>Subexercise name</label>
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
                        <div className="field-group reps-field">
                          <label htmlFor={`step-reps-${step.id}`}>Repetitions</label>
                          <input
                            id={`step-reps-${step.id}`}
                            name={repsErrorKey}
                            type="number"
                            min={0}
                            max={500}
                            step={1}
                            inputMode="numeric"
                            value={step.reps}
                            aria-invalid={
                              showError(repsErrorKey) && errors[repsErrorKey] !== undefined
                            }
                            aria-describedby={
                              showError(repsErrorKey) && errors[repsErrorKey] !== undefined
                                ? `${repsErrorKey}-error`
                                : undefined
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
                          {showError(repsErrorKey) && errors[repsErrorKey] !== undefined ? (
                            <span id={`${repsErrorKey}-error`} className="form-error">
                              {errors[repsErrorKey]}
                            </span>
                          ) : null}
                        </div>
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
                          Remove subexercise
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => update({ type: 'add-step', sectionId: section.id })}
                >
                  Add subexercise
                </button>
              </fieldset>
            );
          })}
        </div>

        <button
          className="secondary-button"
          type="button"
          onClick={() => update({ type: 'add-section' })}
        >
          Add exercise
        </button>
        <div className="builder-actions">
          <button className="primary-button" type="submit">
            Save session to dashboard
          </button>
          <span className="field-hint">
            Every subexercise needs a whole-number repetition target from 0 to 500.
          </span>
        </div>
      </form>
    </>
  );
}
