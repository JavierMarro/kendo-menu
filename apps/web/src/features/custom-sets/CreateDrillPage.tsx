/**
 * Owns custom-session form state and sends validated input to the active workspace store.
 * Guest submission waits for the browser persistence flush before showing the saved-menu notice;
 * account submission adds to the in-memory draft for its separate explicit save flow.
 * Workspace dirty-state callbacks keep an unfinished builder draft visible to transition guards.
 */
import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { flushSync } from 'react-dom';

import {
  isCustomTrainingIntensity,
  MAX_REPETITIONS,
  TRAINING_DATA_LIMITS,
  type DashboardEntry,
} from '@kendo-menu/domain';

import {
  builderReducer,
  createEditBuilderState,
  createInitialBuilderState,
  getBuilderEditIdentities,
  getDraftActivityCount,
  parseBuilderState,
  type BuilderAction,
  type BuilderErrors,
  type BuilderState,
  type StepDraft,
  type StepMeasurement,
} from './builder-state';
import { useTrainingStore } from '../../lib/training-store-context';
import { createSavedMenuNavigationState } from '../../lib/navigation-state';
import { usePersistenceStatus } from '../persistence/persistence-context';
import { useWorkspace, workspacePath } from '../../lib/workspace-context';
import { getDashboardTrainingSet } from '../../lib/training-data';

const EMPTY_BUILDER_ERRORS: BuilderErrors = {};
const MEASUREMENT_LABELS: Record<StepMeasurement, string> = {
  repetitions: 'Repetitions',
  sets: 'Sets',
  duration: 'Duration',
};

function getErrorTargetId(key: string): string {
  if (key === 'name') {
    return 'drill-name';
  }
  if (key === 'description') {
    return 'drill-description';
  }
  if (key === 'sections' || key === 'activities') {
    return 'activities-title';
  }
  if (key.startsWith('section-steps-')) {
    return `exercises-title-${key.slice('section-steps-'.length)}`;
  }
  if (key.startsWith('section-')) {
    return `section-label-${key.slice('section-'.length)}`;
  }
  return key;
}

function DirtyNavigationBlocker({ isDirty }: { readonly isDirty: boolean }) {
  const { builderDirty } = useWorkspace();

  useEffect(() => {
    builderDirty?.(isDirty);
    return () => {
      builderDirty?.(false);
    };
  }, [isDirty, builderDirty]);

  return null;
}

export function CreateDrillPage() {
  return <BuilderForm key="create" initialState={createInitialBuilderState()} />;
}

export function EditDrillPage() {
  const { entryId } = useParams<{ entryId: string }>();
  const entry = useTrainingStore((store) =>
    store.dashboardEntries.find((candidate) => candidate.id === entryId),
  );
  const trainingSet = entry === undefined ? undefined : getDashboardTrainingSet(entry);
  const initialState = entry === undefined ? null : createEditBuilderState(entry);

  if (entry === undefined || trainingSet === undefined) {
    return <EditUnavailablePage message="This menu is not available on this dashboard." />;
  }
  if (trainingSet.isBuiltIn || trainingSet.category !== 'custom' || initialState === null) {
    return <EditUnavailablePage message="Only custom menus can be edited here." />;
  }
  return <BuilderForm key={entry.id} initialState={initialState} entry={entry} />;
}

function EditUnavailablePage({ message }: { readonly message: string }) {
  const workspace = useWorkspace();
  return (
    <section className="empty-state" aria-labelledby="edit-unavailable-title">
      <p className="eyebrow">Custom menu</p>
      <h1 id="edit-unavailable-title">Menu editing unavailable</h1>
      <p>{message}</p>
      <Link className="primary-button" to={workspacePath(workspace.basePath, 'dashboard')}>
        Back to dashboard
      </Link>
    </section>
  );
}

function BuilderForm({
  initialState,
  entry,
}: {
  readonly initialState: BuilderState;
  readonly entry?: DashboardEntry;
}) {
  const isEditing = entry !== undefined;
  const [state, dispatch] = useReducer(builderReducer, initialState);
  const [isDirty, setIsDirty] = useState(false);
  const [submitRequest, setSubmitRequest] = useState(0);
  const [submitError, setSubmitError] = useState('');
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const lastFocusedSubmitRequest = useRef(0);
  const isDirtyRef = useRef(false);
  const addedItemRef = useRef<true | string | null>(null);
  const navigate = useNavigate();
  const createCustomTrainingSet = useTrainingStore(
    (store) => store.createCustomTrainingSetAndAddToDashboard,
  );
  const updateCustomTrainingSet = useTrainingStore((store) => store.updateCustomTrainingSet);
  const persistence = usePersistenceStatus();
  const { flush: flushPersistence } = persistence;
  const workspace = useWorkspace();
  const [isSaving, setIsSaving] = useState(false);
  const parseResult = useMemo(() => parseBuilderState(state), [state]);
  const errors =
    submitRequest === 0 || parseResult.success ? EMPTY_BUILDER_ERRORS : parseResult.errors;
  const draftActivityCount = getDraftActivityCount(state);
  const canAddItem =
    state.sections.length < TRAINING_DATA_LIMITS.customSections &&
    draftActivityCount < TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty || persistence.exitConfirmed) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, persistence.exitConfirmed]);

  useEffect(() => {
    if (submitRequest === 0 || lastFocusedSubmitRequest.current === submitRequest) {
      return;
    }

    lastFocusedSubmitRequest.current = submitRequest;
    if (Object.keys(errors).length > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [errors, submitRequest]);

  useEffect(() => {
    const addedTo = addedItemRef.current;
    if (addedTo === null) return;
    addedItemRef.current = null;

    const item =
      addedTo === true
        ? state.sections.at(-1)
        : state.sections.find((candidate) => candidate.id === addedTo);
    if (item === undefined) return;
    const fieldId =
      'steps' in item
        ? addedTo === true
          ? `section-label-${item.id}`
          : `step-label-${item.steps.at(-1)?.id}`
        : `step-label-${item.id}`;
    document.getElementById(fieldId)?.focus();
  }, [state.sections]);

  const update = (action: BuilderAction) => {
    if (action.type === 'add-section' || action.type === 'add-standalone-exercise') {
      addedItemRef.current = true;
    } else if (action.type === 'add-step') {
      addedItemRef.current = action.sectionId;
    }
    dispatch(action);
    isDirtyRef.current = true;
    setIsDirty(true);
    workspace.builderDirty?.(true);
  };

  const setBuilderDirtyState = (dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirty(dirty);
    workspace.builderDirty?.(dirty);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }
    setSubmitRequest((request) => request + 1);
    setSubmitError('');

    if (!parseResult.success) {
      return;
    }

    setIsSaving(true);
    let saved = false;
    try {
      const input = parseResult.value;
      if (entry === undefined) {
        createCustomTrainingSet(input);
      } else {
        updateCustomTrainingSet(entry.id, input, getBuilderEditIdentities(state));
      }
      saved = true;
      // Guests wait for the durable local write; account changes remain in their memory draft.
      try {
        if (workspace.kind === 'guest') await flushPersistence();
        flushSync(() => setBuilderDirtyState(false));
        const navigation = navigate(
          workspacePath(workspace.basePath, 'dashboard'),
          entry === undefined ? { state: createSavedMenuNavigationState(input.name) } : undefined,
        );
        void Promise.resolve(navigation).catch(() => {
          setBuilderDirtyState(true);
          setSubmitError(
            isEditing
              ? workspace.kind === 'account'
                ? 'The menu was updated in your account draft, but KendoMenu could not open the dashboard.'
                : 'The menu was saved, but KendoMenu could not open the dashboard.'
              : workspace.kind === 'account'
                ? 'The menu was added to your account draft, but KendoMenu could not open the dashboard.'
                : 'The session was saved, but KendoMenu could not open the dashboard.',
          );
        });
      } catch {
        // Keep the live entry available while the persistence warning offers recovery and backup.
        flushSync(() => setBuilderDirtyState(false));
        const navigation = navigate(workspacePath(workspace.basePath, 'dashboard'));
        void Promise.resolve(navigation).catch(() => {
          setBuilderDirtyState(true);
          setSubmitError(
            isEditing
              ? 'The menu was updated in memory, but KendoMenu could not confirm it was saved or open the dashboard.'
              : 'The session was added in memory, but KendoMenu could not confirm it was saved or open the dashboard.',
          );
        });
      }
    } catch {
      setSubmitError(
        saved
          ? isEditing
            ? 'The menu could not be confirmed as saved. Your draft is still here; try again.'
            : 'The session could not be confirmed as saved. Your draft is still here; try again.'
          : isEditing
            ? 'The menu could not be saved. Your draft is still here; try again.'
            : 'The session could not be saved. Your draft is still here; try again.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="builder-page">
      <DirtyNavigationBlocker isDirty={isDirty} />
      <header className="page-header builder-header">
        <Link
          className="builder-back-link"
          to={workspacePath(workspace.basePath, isEditing ? 'dashboard' : 'library')}
        >
          <span aria-hidden="true">← </span>
          {isEditing ? 'Back to dashboard' : 'Back to keiko library'}
        </Link>
        <div>
          <p className="eyebrow">Your own practice</p>
          <h1>{isEditing ? 'Edit menu' : 'Create a training session'}</h1>
          <p className="page-intro">
            {isEditing
              ? 'Update the activities and exercises in your custom keiko session.'
              : 'Build a repeatable keiko session containing the activities and exercises you want to practise.'}
          </p>
        </div>
      </header>

      <form className="builder-form" onSubmit={handleSubmit} noValidate inert={!workspace.canEdit}>
        <fieldset className="builder-editable-fields" disabled={!workspace.canEdit}>
          <legend className="sr-only">Session draft fields</legend>
          {Object.keys(errors).length > 0 ? (
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
          {isEditing && !workspace.canEdit ? (
            <p className="form-error" role="status">
              Menu editing is temporarily unavailable. Your draft will stay open while access is
              restored.
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
                  maxLength={TRAINING_DATA_LIMITS.nameCharacters}
                  value={state.name}
                  aria-invalid={errors['name'] !== undefined}
                  aria-describedby={errors['name'] !== undefined ? 'drill-name-error' : undefined}
                  onChange={(event) => update({ type: 'set-name', value: event.target.value })}
                />
                {errors['name'] !== undefined ? (
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
                  maxLength={TRAINING_DATA_LIMITS.descriptionCharacters}
                  aria-invalid={errors['description'] !== undefined}
                  aria-describedby={
                    errors['description'] !== undefined ? 'drill-description-error' : undefined
                  }
                  onChange={(event) =>
                    update({ type: 'set-description', value: event.target.value })
                  }
                />
                {errors['description'] !== undefined ? (
                  <span id="drill-description-error" className="form-error">
                    {errors['description']}
                  </span>
                ) : null}
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
                <span className="field-hint">
                  Choose one intensity tag for this custom session.
                </span>
              </div>
            </div>
          </section>

          <section className="builder-form-section" aria-labelledby="activities-title">
            <div className="builder-form-section-heading">
              <h2 id="activities-title" tabIndex={-1}>
                Your keiko
              </h2>
              <p>Group related exercises in an activity, or add an exercise on its own.</p>
            </div>

            {state.sections.length === 0 ? (
              <p className="field-hint">Add your first activity or exercise below.</p>
            ) : null}
            <div className="builder-sections">
              {state.sections.map((item, index) => {
                const isActivity = 'steps' in item;
                const itemKind = isActivity ? 'Activity' : 'Exercise';
                const itemTitleId = `builder-item-title-${item.id}`;
                const sectionErrorKey = `section-${item.id}`;
                const exercisesErrorKey = `section-steps-${item.id}`;
                const exercisesTitleId = `exercises-title-${item.id}`;
                return (
                  <fieldset className="builder-section" key={item.id} aria-labelledby={itemTitleId}>
                    <legend className="sr-only">
                      {itemKind} {index + 1}
                    </legend>
                    <div className="builder-activity-header">
                      <h3 id={itemTitleId}>
                        {itemKind} {index + 1}
                      </h3>
                      <button
                        className="text-button destructive-button"
                        type="button"
                        onClick={() => update({ type: 'remove-section', sectionId: item.id })}
                      >
                        Remove {itemKind.toLowerCase()}
                      </button>
                    </div>
                    {isActivity ? (
                      <>
                        <div className="field-group builder-activity-name-field">
                          <label htmlFor={`section-label-${item.id}`}>Activity name</label>
                          <input
                            id={`section-label-${item.id}`}
                            name={sectionErrorKey}
                            type="text"
                            maxLength={TRAINING_DATA_LIMITS.nameCharacters}
                            value={item.label}
                            aria-invalid={errors[sectionErrorKey] !== undefined}
                            aria-describedby={
                              errors[sectionErrorKey] !== undefined
                                ? `${sectionErrorKey}-error`
                                : undefined
                            }
                            onChange={(event) =>
                              update({
                                type: 'set-section-label',
                                sectionId: item.id,
                                value: event.target.value,
                              })
                            }
                          />
                          {errors[sectionErrorKey] !== undefined ? (
                            <span id={`${sectionErrorKey}-error`} className="form-error">
                              {errors[sectionErrorKey]}
                            </span>
                          ) : null}
                        </div>

                        <fieldset
                          className="builder-exercise-group"
                          aria-labelledby={exercisesTitleId}
                        >
                          <legend id={exercisesTitleId}>Exercises</legend>
                          {errors[exercisesErrorKey] !== undefined ? (
                            <span className="form-error">{errors[exercisesErrorKey]}</span>
                          ) : null}
                          {item.steps.length > 0 ? (
                            <ol className="builder-step-list">
                              {item.steps.map((step, stepIndex) => (
                                <li className="builder-step" key={step.id}>
                                  <span className="step-number" aria-hidden="true">
                                    {stepIndex + 1}
                                  </span>
                                  <ExerciseFields step={step} errors={errors} update={update} />
                                  <button
                                    className="text-button destructive-button"
                                    type="button"
                                    onClick={() =>
                                      update({
                                        type: 'remove-step',
                                        sectionId: item.id,
                                        stepId: step.id,
                                      })
                                    }
                                  >
                                    Remove exercise
                                  </button>
                                </li>
                              ))}
                            </ol>
                          ) : null}
                          <button
                            className="text-button builder-add-exercise"
                            type="button"
                            disabled={
                              item.steps.length >= TRAINING_DATA_LIMITS.exercisesPerSection ||
                              draftActivityCount >=
                                TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet
                            }
                            onClick={() => update({ type: 'add-step', sectionId: item.id })}
                          >
                            Add exercise to activity
                          </button>
                        </fieldset>
                      </>
                    ) : (
                      <div className="builder-step builder-step--standalone">
                        <ExerciseFields step={item} errors={errors} update={update} />
                      </div>
                    )}
                  </fieldset>
                );
              })}
            </div>
          </section>

          <div className="builder-actions">
            {isEditing ? (
              <Link
                className="secondary-button"
                to={workspacePath(workspace.basePath, 'dashboard')}
              >
                Cancel
              </Link>
            ) : null}
            <button
              className="secondary-button"
              type="button"
              disabled={!canAddItem}
              onClick={() => update({ type: 'add-section' })}
            >
              Add activity
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!canAddItem}
              onClick={() => update({ type: 'add-standalone-exercise' })}
            >
              Add exercise
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={isSaving}
              aria-busy={isSaving}
            >
              {isEditing ? 'Save changes' : 'Save session to dashboard'}
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}

function ExerciseFields({
  step,
  errors,
  update,
}: {
  readonly step: StepDraft;
  readonly errors: BuilderErrors;
  readonly update: (action: BuilderAction) => void;
}) {
  const labelKey = `step-label-${step.id}`;
  const quantityKey = `step-reps-${step.id}`;
  const quantityHintId = `quantity-hint-${step.id}`;
  const labelError = errors[labelKey];
  const quantityError = errors[quantityKey];
  const isDuration = step.measurement === 'duration';
  const keepExistingQuantity =
    step.activityId !== undefined && step.quantityChanged !== true && step.reps.length === 0;
  const quantityHint = keepExistingQuantity
    ? 'Leave blank to keep the existing quantity, including a duration range.'
    : isDuration
      ? `Use ${step.durationUnit}; zero and decimal values are supported.`
      : step.measurement === 'sets'
        ? 'Use a whole number, 0 or more.'
        : `Use a whole number from 0 to ${MAX_REPETITIONS}.`;

  return (
    <>
      <div className="field-group builder-step-name-field">
        <label htmlFor={labelKey}>Exercise name</label>
        <input
          id={labelKey}
          name={labelKey}
          type="text"
          maxLength={TRAINING_DATA_LIMITS.nameCharacters}
          value={step.label}
          aria-invalid={labelError !== undefined}
          aria-describedby={labelError === undefined ? undefined : `${labelKey}-error`}
          onChange={(event) =>
            update({ type: 'set-step-label', stepId: step.id, value: event.target.value })
          }
        />
        {labelError === undefined ? null : (
          <span id={`${labelKey}-error`} className="form-error">
            {labelError}
          </span>
        )}
      </div>
      <div className="field-group builder-measurement-field">
        <label htmlFor={`step-measurement-${step.id}`}>Measurement</label>
        <select
          id={`step-measurement-${step.id}`}
          value={step.measurement}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'repetitions' || value === 'sets' || value === 'duration') {
              update({ type: 'set-step-measurement', stepId: step.id, value });
            }
          }}
        >
          <option value="repetitions">Repetitions</option>
          <option value="sets">Sets</option>
          <option value="duration">Duration</option>
        </select>
      </div>
      <div className="field-group builder-quantity-field">
        <label htmlFor={quantityKey}>{MEASUREMENT_LABELS[step.measurement]}</label>
        <input
          id={quantityKey}
          name={quantityKey}
          type="number"
          min={0}
          max={step.measurement === 'repetitions' ? MAX_REPETITIONS : undefined}
          step={isDuration ? 'any' : 1}
          inputMode={isDuration ? 'decimal' : 'numeric'}
          value={step.reps}
          aria-invalid={quantityError !== undefined}
          aria-describedby={
            quantityError === undefined ? quantityHintId : `${quantityHintId} ${quantityKey}-error`
          }
          onChange={(event) =>
            update({ type: 'set-step-reps', stepId: step.id, value: event.target.value })
          }
        />
        <span id={quantityHintId} className="field-hint">
          {quantityHint}
        </span>
        {quantityError === undefined ? null : (
          <span id={`${quantityKey}-error`} className="form-error">
            {quantityError}
          </span>
        )}
      </div>
      {isDuration ? (
        <div className="field-group builder-duration-unit-field">
          <label htmlFor={`step-duration-unit-${step.id}`}>Duration unit</label>
          <select
            id={`step-duration-unit-${step.id}`}
            value={step.durationUnit}
            onChange={(event) =>
              update({
                type: 'set-step-duration-unit',
                stepId: step.id,
                value: event.target.value === 'seconds' ? 'seconds' : 'minutes',
              })
            }
          >
            <option value="minutes">Minutes</option>
            <option value="seconds">Seconds</option>
          </select>
        </div>
      ) : (
        <div className="builder-duration-unit-placeholder" aria-hidden="true" />
      )}
    </>
  );
}
