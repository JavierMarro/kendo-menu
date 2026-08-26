import { useState, type ChangeEvent, type FocusEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import type {
  DashboardEntry,
  TrainingActivity,
  TrainingQuantityUnit,
  TrainingSet,
} from '@kendo-menu/domain';
import type { RemovedDashboardEntry } from '@kendo-menu/store';

import {
  findTrainingSet,
  formatCategory,
  formatQuantityValue,
  formatQuantityUnit,
  getAllTrainingSets,
  getEditableTrainingQuantityUnits,
  getEffectiveTrainingQuantity,
  getQuantityValidationMessage,
  getTrainingQuantityValue,
  getTrainingSetActivityCount,
  getTrainingSetDescription,
  getTrainingSetSections,
  isTrainingQuantityRange,
  isValidQuantityValue,
} from '../../lib/training-data';
import { useTrainingStore, useTrainingStoreApi } from '../../lib/training-store-context';
import {
  getPersistenceUpdateLabel,
  usePersistenceStatus,
} from '../persistence/persistence-context';

function getQuantityDraftValue(
  entry: DashboardEntry,
  activity: TrainingActivity,
  unit: TrainingQuantityUnit,
): string {
  const value = getEffectiveTrainingQuantity(entry, activity, unit);
  return value === undefined || isTrainingQuantityRange(value) ? '' : String(value);
}

export function DashboardPage() {
  const dashboardEntries = useTrainingStore((state) => state.dashboardEntries);
  const customTrainingSets = useTrainingStore((state) => state.customTrainingSets);
  const removeFromDashboard = useTrainingStore((state) => state.removeFromDashboard);
  const updateDashboardEntry = useTrainingStore((state) => state.updateDashboardEntry);
  const setQuantityOverride = useTrainingStore((state) => state.setQuantityOverride);
  const clearQuantityOverride = useTrainingStore((state) => state.clearQuantityOverride);
  const store = useTrainingStoreApi();
  const [removedEntry, setRemovedEntry] = useState<RemovedDashboardEntry | null>(null);
  const [searchParams] = useSearchParams();
  const persistenceStatus = usePersistenceStatus();
  const [statusMessage, setStatusMessage] = useState('');
  const trainingSets = getAllTrainingSets(customTrainingSets);
  const createdName = searchParams.get('created');
  const createdStatusMessage =
    createdName === null
      ? ''
      : persistenceStatus.writeFailed
        ? `${createdName} was added, but changes are not being saved to this device.`
        : persistenceStatus.mode === 'session'
          ? `${createdName} was added for this session only.`
          : `${createdName} saved to your dashboard.`;

  const removeEntry = (entry: DashboardEntry, label = 'Training set') => {
    const removed = removeFromDashboard(entry.id);
    if (removed === null) {
      return;
    }

    setRemovedEntry(removed);
    setStatusMessage(`${label} was removed from your dashboard.`);
  };

  const undoRemove = () => {
    if (removedEntry === null) {
      return;
    }

    store.getState().restoreDashboardEntry(removedEntry);
    setRemovedEntry(null);
    setStatusMessage('Training set restored to its previous position.');
  };

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Today&apos;s keiko</p>
          <h1>Your dashboard</h1>
          <p className="page-intro">
            Shape a focused session, then adjust the work to match the practice in front of you.
          </p>
        </div>
        <Link className="primary-button" to="/app/drills/new">
          Create drill
        </Link>
      </header>

      <p className="sr-only" role="status" aria-live="polite">
        {statusMessage || createdStatusMessage}
      </p>
      {removedEntry !== null ? (
        <div className="undo-banner" role="status">
          <span>Training set removed.</span>
          <button className="text-button" type="button" onClick={undoRemove}>
            Undo
          </button>
        </div>
      ) : null}

      {dashboardEntries.length === 0 ? (
        <section className="empty-state" aria-labelledby="empty-dashboard-title">
          <p className="eyebrow">A clean starting line</p>
          <h2 id="empty-dashboard-title">Your dashboard is ready.</h2>
          <p>
            Add a drill from the library and shape it for today&apos;s practice. Quantities and
            notes stay on this device as you refine the set.
          </p>
          <div className="empty-actions">
            <Link className="primary-button" to="/app/library">
              Browse drill library
            </Link>
            <Link className="secondary-button" to="/app/drills/new">
              Create a drill
            </Link>
          </div>
        </section>
      ) : (
        <section className="dashboard-list" aria-labelledby="dashboard-list-title">
          <h2 id="dashboard-list-title" className="sr-only">
            Selected training sets
          </h2>
          {dashboardEntries.map((entry, index) => {
            const trainingSet = findTrainingSet(trainingSets, entry.trainingSetId);
            return trainingSet === undefined ? (
              <UnknownDashboardEntry
                key={entry.id}
                entry={entry}
                onRemove={() => removeEntry(entry)}
              />
            ) : (
              <DashboardTrainingSet
                key={entry.id}
                entry={entry}
                index={index}
                trainingSet={trainingSet}
                onRemove={() => removeEntry(entry, trainingSet.name)}
                onUpdate={(patch) => updateDashboardEntry(entry.id, patch)}
                onSetQuantity={(activityId, unit, value) =>
                  setQuantityOverride(entry.id, activityId, unit, value)
                }
                onClearQuantity={(activityId, unit) =>
                  clearQuantityOverride(entry.id, activityId, unit)
                }
              />
            );
          })}
        </section>
      )}
    </>
  );
}

interface UnknownDashboardEntryProps {
  readonly entry: DashboardEntry;
  readonly onRemove: () => void;
}

function UnknownDashboardEntry({ entry, onRemove }: UnknownDashboardEntryProps) {
  return (
    <article className="dashboard-card dashboard-card--missing">
      <div className="card-index" aria-hidden="true">
        !
      </div>
      <div className="card-content">
        <p className="card-kicker">Unavailable drill</p>
        <h2>Training set unavailable</h2>
        <p>The drill for this dashboard entry is no longer available in local data.</p>
      </div>
      <button className="text-button" type="button" onClick={onRemove}>
        Remove
      </button>
      <span className="sr-only">Entry {entry.id}</span>
    </article>
  );
}

interface DashboardTrainingSetProps {
  readonly entry: DashboardEntry;
  readonly index: number;
  readonly trainingSet: TrainingSet;
  readonly onRemove: () => void;
  readonly onUpdate: (patch: { readonly notes?: string }) => void;
  readonly onSetQuantity: (activityId: string, unit: TrainingQuantityUnit, value: number) => void;
  readonly onClearQuantity: (activityId: string, unit: TrainingQuantityUnit) => void;
}

function DashboardTrainingSet({
  entry,
  index,
  trainingSet,
  onRemove,
  onUpdate,
  onSetQuantity,
  onClearQuantity,
}: DashboardTrainingSetProps) {
  const [notesDraft, setNotesDraft] = useState(entry.notes);
  const [notesStatus, setNotesStatus] = useState<'idle' | 'updated'>('idle');
  const persistenceStatus = usePersistenceStatus();
  const sections = getTrainingSetSections(trainingSet);
  const activityCount = getTrainingSetActivityCount(trainingSet);

  const handleNotesChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setNotesDraft(event.target.value);
    setNotesStatus('idle');
  };

  const handleNotesBlur = () => {
    if (notesDraft !== entry.notes) {
      onUpdate({ notes: notesDraft });
      setNotesStatus('updated');
    }
  };

  return (
    <article className="dashboard-card dashboard-card--expanded">
      <div className="dashboard-card-heading">
        <div className="card-index" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </div>
        <div className="card-content">
          <p className="card-kicker">{formatCategory(trainingSet.category)}</p>
          <h2>{trainingSet.name}</h2>
          <p>{getTrainingSetDescription(trainingSet)}</p>
          <div className="card-meta">
            <span>{activityCount} activities</span>
            <span>{entry.notes.length > 0 ? 'Has notes' : 'No notes yet'}</span>
          </div>
        </div>
        <button className="text-button" type="button" onClick={onRemove}>
          Remove
        </button>
      </div>

      <div className="dashboard-sections">
        {sections.map((section, sectionIndex) => (
          <section
            className="training-section"
            key={section.id}
            aria-labelledby={`${entry.id}-${section.id}`}
          >
            <div className="training-section-heading">
              <span className="section-number" aria-hidden="true">
                {sectionIndex + 1}
              </span>
              <h3 id={`${entry.id}-${section.id}`}>{section.name}</h3>
            </div>
            {section.exercises.length === 0 || section.quantities !== undefined ? (
              <div className="training-step training-step--standalone">
                {section.notes !== undefined && section.notes.length > 0 ? (
                  <span className="step-description">{section.notes}</span>
                ) : null}
                <QuantityEditors
                  entry={entry}
                  activity={section}
                  onSet={onSetQuantity}
                  onClear={onClearQuantity}
                />
              </div>
            ) : section.notes !== undefined && section.notes.length > 0 ? (
              <p className="step-description">{section.notes}</p>
            ) : null}
            {section.exercises.length > 0 ? (
              <ol className="training-step-list">
                {section.exercises.map((exercise, exerciseIndex) => (
                  <li className="training-step" key={exercise.id}>
                    <span className="step-number" aria-hidden="true">
                      {exerciseIndex + 1}
                    </span>
                    <div className="step-copy">
                      <span className="step-label">{exercise.name}</span>
                      {exercise.notes !== undefined && exercise.notes.length > 0 ? (
                        <span className="step-description">{exercise.notes}</span>
                      ) : null}
                    </div>
                    <QuantityEditors
                      entry={entry}
                      activity={exercise}
                      sectionName={section.name}
                      onSet={onSetQuantity}
                      onClear={onClearQuantity}
                    />
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        ))}
      </div>

      <div className="notes-field">
        <label htmlFor={`notes-${entry.id}`}>Practice notes</label>
        <textarea
          id={`notes-${entry.id}`}
          value={notesDraft}
          placeholder="What do you want to remember for this session?"
          rows={3}
          onBlur={handleNotesBlur}
          onChange={handleNotesChange}
        />
        <span className="field-status" role="status" aria-live="polite">
          {notesStatus === 'updated' ? getPersistenceUpdateLabel(persistenceStatus) : ''}
        </span>
      </div>
    </article>
  );
}

interface QuantityEditorsProps {
  readonly entry: DashboardEntry;
  readonly activity: TrainingActivity;
  readonly sectionName?: string;
  readonly onSet: (activityId: string, unit: TrainingQuantityUnit, value: number) => void;
  readonly onClear: (activityId: string, unit: TrainingQuantityUnit) => void;
}

function QuantityEditors({ entry, activity, sectionName, onSet, onClear }: QuantityEditorsProps) {
  const units = getEditableTrainingQuantityUnits(entry, activity, sectionName);

  return (
    <div className="quantity-editor-group">
      {units.map((unit) => (
        <QuantityEditor
          key={unit}
          entry={entry}
          activity={activity}
          unit={unit}
          onSet={onSet}
          onClear={onClear}
        />
      ))}
    </div>
  );
}

interface QuantityEditorProps extends QuantityEditorsProps {
  readonly unit: TrainingQuantityUnit;
}

function QuantityEditor({ entry, activity, unit, onSet, onClear }: QuantityEditorProps) {
  const [draft, setDraft] = useState(() => getQuantityDraftValue(entry, activity, unit));
  const [feedback, setFeedback] = useState<'idle' | 'updated' | 'invalid'>('idle');
  const persistenceStatus = usePersistenceStatus();
  const inputId = `quantity-${unit}-${entry.id}-${activity.id}`;
  const messageId = `${inputId}-message`;
  const unitLabel = formatQuantityUnit(unit, 2);
  const accessibleUnitLabel = `${unitLabel.charAt(0).toUpperCase()}${unitLabel.slice(1)}`;
  const defaultValue = getTrainingQuantityValue(activity, unit);
  const placeholder =
    defaultValue !== undefined && isTrainingQuantityRange(defaultValue)
      ? `${formatQuantityValue(defaultValue.min)}–${formatQuantityValue(defaultValue.max)}`
      : 'Not specified';
  const feedbackMessage =
    feedback === 'invalid'
      ? getQuantityValidationMessage(unit)
      : feedback === 'updated'
        ? getPersistenceUpdateLabel(persistenceStatus)
        : '';

  const commit = (event: FocusEvent<HTMLInputElement>) => {
    const rawValue = event.currentTarget.value.trim();
    const activityOverrides = entry.quantityOverrides[activity.id];
    const hasOverride = activityOverrides !== undefined && Object.hasOwn(activityOverrides, unit);

    if (rawValue === '') {
      const defaultValue = getTrainingQuantityValue(activity, unit);
      if (!hasOverride && defaultValue === undefined) {
        setFeedback('idle');
        return;
      }
      onClear(activity.id, unit);
      setDraft(
        defaultValue === undefined || isTrainingQuantityRange(defaultValue)
          ? ''
          : String(defaultValue),
      );
      setFeedback('updated');
      return;
    }

    const value = Number(rawValue);
    if (!isValidQuantityValue(unit, value)) {
      setFeedback('invalid');
      return;
    }

    const effectiveValue = getEffectiveTrainingQuantity(entry, activity, unit);
    if (typeof effectiveValue === 'number' && value === effectiveValue) {
      setDraft(String(value));
      setFeedback('idle');
      return;
    }

    onSet(activity.id, unit, value);
    setDraft(String(value));
    setFeedback('updated');
  };

  return (
    <div className="quantity-editor">
      <label htmlFor={inputId}>
        {accessibleUnitLabel} for {activity.name}
      </label>
      <div className="quantity-input-wrap">
        <input
          id={inputId}
          type="number"
          min={0}
          max={unit === 'repetitions' ? 500 : undefined}
          step={unit === 'minutes' || unit === 'seconds' ? 'any' : 1}
          inputMode={unit === 'minutes' || unit === 'seconds' ? 'decimal' : 'numeric'}
          value={draft}
          placeholder={placeholder}
          aria-describedby={feedbackMessage.length > 0 ? messageId : undefined}
          aria-invalid={feedback === 'invalid'}
          onChange={(event) => {
            setDraft(event.target.value);
            setFeedback('idle');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
          onBlur={commit}
        />
        <span aria-hidden="true">{unitLabel}</span>
      </div>
      {feedbackMessage.length > 0 ? (
        <span
          id={messageId}
          className={feedback === 'invalid' ? 'form-error' : 'field-status'}
          role="status"
        >
          {feedbackMessage}
        </span>
      ) : null}
    </div>
  );
}
