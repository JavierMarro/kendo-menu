import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
} from 'react';
import {
  Link,
  NavigationType,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom';

import type {
  DashboardEntry,
  TrainingActivity,
  TrainingQuantityUnit,
  TrainingSet,
} from '@kendo-menu/domain';
import { TRAINING_DATA_LIMITS } from '@kendo-menu/domain';
import type { RemovedDashboardEntry } from '@kendo-menu/store';

import {
  DASHBOARD_FILTER_OPTIONS,
  filterDashboardEntries,
  formatQuantityValue,
  formatQuantityUnit,
  getDashboardTrainingSet,
  getEditableTrainingQuantityUnits,
  getEffectiveTrainingQuantity,
  getQuantityValidationMessage,
  getTrainingQuantityValue,
  getTrainingSetActivityCount,
  getTrainingSetDescription,
  isTrainingQuantityRange,
  isValidQuantityValue,
  type DashboardFilter,
} from '../../lib/training-data';
import { useTrainingStore, useTrainingStoreApi } from '../../lib/training-store-context';
import { DialogShell } from '../../components/DialogShell';
import {
  TrainingActivityList,
  type TrainingActivityRenderContext,
} from '../../components/TrainingActivityList';
import { TrainingSetTags } from '../../components/TrainingSetTags';
import { getSavedMenuNavigationState } from '../../lib/navigation-state';
import {
  getExplicitPersistenceUpdateLabel,
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

const MAX_QUANTITY_DIGITS = 3;

interface PendingNavigationStateClear {
  readonly sourceKey: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

function hasAllowedQuantityDraftLength(value: string): boolean {
  if (value.includes('e') || value.includes('E') || value.includes('+')) {
    return false;
  }

  let digitCount = 0;
  for (const character of value) {
    if (character >= '0' && character <= '9') {
      digitCount += 1;
    }
  }

  return digitCount <= MAX_QUANTITY_DIGITS;
}

export function DashboardPage() {
  const dashboardEntries = useTrainingStore((state) => state.dashboardEntries);
  const removeFromDashboard = useTrainingStore((state) => state.removeFromDashboard);
  const updateDashboardEntry = useTrainingStore((state) => state.updateDashboardEntry);
  const setQuantityOverride = useTrainingStore((state) => state.setQuantityOverride);
  const clearQuantityOverride = useTrainingStore((state) => state.clearQuantityOverride);
  const setActivityNote = useTrainingStore((state) => state.setActivityNote);
  const store = useTrainingStoreApi();
  const [removedEntry, setRemovedEntry] = useState<RemovedDashboardEntry | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const persistenceStatus = usePersistenceStatus();
  const [statusMessage, setStatusMessage] = useState('');
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>('all');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const savedMenuNavigationState = getSavedMenuNavigationState(location.state);
  const [createdName, setCreatedName] = useState<string | null>(
    () => savedMenuNavigationState?.menuName ?? null,
  );
  const consumedNavigationKeyRef = useRef<string | null>(null);
  const pendingNavigationStateClearRef = useRef<PendingNavigationStateClear | null>(null);
  const viewMoreButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const previousSelectedEntryIdRef = useRef<string | null>(null);
  const filteredEntries = useMemo(
    () => filterDashboardEntries(dashboardEntries, dashboardFilter),
    [dashboardEntries, dashboardFilter],
  );
  const selectedEntry =
    selectedEntryId === null
      ? undefined
      : filteredEntries.find((entry) => entry.id === selectedEntryId);
  const selectedTrainingSet =
    selectedEntry === undefined ? undefined : getDashboardTrainingSet(selectedEntry);
  const visibleSelectedEntryId = selectedEntry?.id ?? null;
  const createdStatusMessage =
    createdName === null
      ? ''
      : persistenceStatus.writeFailed
        ? `${createdName} was added, but changes are not being saved to this device.`
        : persistenceStatus.mode === 'session'
          ? `${createdName} was added for this session only.`
          : `${createdName} saved to your dashboard.`;

  useEffect(() => {
    if (savedMenuNavigationState === null) {
      const pendingNavigationStateClear = pendingNavigationStateClearRef.current;
      const isInternalStateClear =
        pendingNavigationStateClear !== null &&
        navigationType === NavigationType.Replace &&
        pendingNavigationStateClear.pathname === location.pathname &&
        pendingNavigationStateClear.search === location.search &&
        pendingNavigationStateClear.hash === location.hash;

      if (isInternalStateClear) {
        pendingNavigationStateClearRef.current = null;
        return;
      }

      pendingNavigationStateClearRef.current = null;
      consumedNavigationKeyRef.current = null;
      setCreatedName(null);
      return;
    }

    if (consumedNavigationKeyRef.current === location.key) {
      return;
    }

    consumedNavigationKeyRef.current = location.key;
    setCreatedName(savedMenuNavigationState.menuName);
    pendingNavigationStateClearRef.current = {
      sourceKey: location.key,
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    };

    const resetPendingNavigationStateClear = () => {
      if (pendingNavigationStateClearRef.current?.sourceKey === location.key) {
        pendingNavigationStateClearRef.current = null;
      }
      if (consumedNavigationKeyRef.current === location.key) {
        consumedNavigationKeyRef.current = null;
      }
    };

    try {
      const navigation = navigate(
        {
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
        },
        { replace: true, state: null },
      );
      void Promise.resolve(navigation).catch(resetPendingNavigationStateClear);
    } catch {
      resetPendingNavigationStateClear();
    }
  }, [
    location.hash,
    location.key,
    location.pathname,
    location.search,
    navigate,
    navigationType,
    savedMenuNavigationState,
  ]);

  useEffect(() => {
    if (visibleSelectedEntryId !== null) {
      previousSelectedEntryIdRef.current = visibleSelectedEntryId;
      return;
    }

    const previousEntryId = previousSelectedEntryIdRef.current;
    previousSelectedEntryIdRef.current = null;
    if (previousEntryId === null) {
      return;
    }

    const viewMoreButton = viewMoreButtonsRef.current.get(previousEntryId);
    if (viewMoreButton !== undefined) {
      viewMoreButton.focus({ preventScroll: true });
      return;
    }

    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [visibleSelectedEntryId]);

  const handleDashboardFilterChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = event.target.value;
    const option = DASHBOARD_FILTER_OPTIONS.find((candidate) => candidate.value === selectedValue);
    if (option === undefined) {
      return;
    }

    if (selectedEntryId !== null) {
      setSelectedEntryId(null);
    }
    setDashboardFilter(option.value);
  };

  const removeEntry = (entry: DashboardEntry, label = 'Training session') => {
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
    setStatusMessage('Training session restored to its previous position.');
  };

  return (
    <>
      <header className="page-header dashboard-page-header">
        <div>
          <p className="eyebrow">Today&apos;s keiko</p>
          <h1>Your dashboard</h1>
          <p className="page-intro">Shape today’s keiko to fit the practice ahead.</p>
        </div>
        {dashboardEntries.length > 0 ? (
          <div className="dashboard-header-actions">
            <Link className="secondary-button" to="/app/drills/new">
              Create new menu
            </Link>
            <div className="dashboard-filter-control">
              <label htmlFor="dashboard-filter">Filter sessions</label>
              <select
                id="dashboard-filter"
                value={dashboardFilter}
                onChange={handleDashboardFilterChange}
              >
                {DASHBOARD_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </header>

      <p className="sr-only" role="status" aria-live="polite">
        {statusMessage || createdStatusMessage}
      </p>
      {removedEntry !== null ? (
        <div className="undo-banner" role="status">
          <span>Training session removed.</span>
          <button className="text-button" type="button" onClick={undoRemove}>
            Undo
          </button>
        </div>
      ) : null}

      {dashboardEntries.length === 0 ? (
        <section
          className="empty-state empty-state--dashboard"
          aria-labelledby="empty-dashboard-title"
        >
          <p className="eyebrow">A clean starting line</p>
          <h2 id="empty-dashboard-title">Your dashboard is ready.</h2>
          <p>
            Add a session from the Keiko library and shape it for today&apos;s practice. Quantities
            and notes stay on this device as you refine the session.
          </p>
          <div className="empty-actions">
            <Link className="primary-button" to="/app/library">
              Browse Keiko library
            </Link>
            <Link className="secondary-button" to="/app/drills/new">
              Create a training session
            </Link>
          </div>
        </section>
      ) : filteredEntries.length === 0 ? (
        <section
          className="empty-state dashboard-filter-empty"
          aria-labelledby="filter-empty-title"
        >
          <p className="eyebrow">No matching sessions</p>
          <h2 id="filter-empty-title">Nothing matches this filter.</h2>
          <p>Choose another session tag to see the training on your dashboard.</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setDashboardFilter('all')}
          >
            Show all sessions
          </button>
        </section>
      ) : (
        <section className="dashboard-list" aria-labelledby="dashboard-list-title">
          <h2 id="dashboard-list-title" className="sr-only">
            Selected training sessions
          </h2>
          {filteredEntries.map((entry) => {
            const trainingSet = getDashboardTrainingSet(entry);
            return trainingSet === undefined ? (
              <UnknownDashboardEntry
                key={entry.id}
                entry={entry}
                onRemove={() => removeEntry(entry)}
              />
            ) : (
              <DashboardTrainingSetCard
                key={entry.id}
                entry={entry}
                trainingSet={trainingSet}
                onRemove={() => removeEntry(entry, trainingSet.name)}
                onViewMore={() => setSelectedEntryId(entry.id)}
                viewMoreButtonRef={(element) => {
                  if (element === null) {
                    viewMoreButtonsRef.current.delete(entry.id);
                    return;
                  }

                  viewMoreButtonsRef.current.set(entry.id, element);
                }}
              />
            );
          })}
        </section>
      )}

      {selectedEntry !== undefined && selectedTrainingSet !== undefined ? (
        <DialogShell
          key={selectedEntry.id}
          titleId={`dashboard-dialog-title-${selectedEntry.id}`}
          closeLabel={`Close ${selectedTrainingSet.name} details.`}
          onClose={() => setSelectedEntryId(null)}
        >
          <DashboardTrainingSet
            entry={selectedEntry}
            index={dashboardEntries.findIndex((entry) => entry.id === selectedEntry.id)}
            titleId={`dashboard-dialog-title-${selectedEntry.id}`}
            trainingSet={selectedTrainingSet}
            onRemove={() => {
              setSelectedEntryId(null);
              removeEntry(selectedEntry, selectedTrainingSet.name);
            }}
            onUpdate={(patch) => updateDashboardEntry(selectedEntry.id, patch)}
            onSetQuantity={(activityId, unit, value) =>
              setQuantityOverride(selectedEntry.id, activityId, unit, value)
            }
            onClearQuantity={(activityId, unit) =>
              clearQuantityOverride(selectedEntry.id, activityId, unit)
            }
            onSetActivityNote={(activityId, note) =>
              setActivityNote(selectedEntry.id, activityId, note)
            }
          />
        </DialogShell>
      ) : null}
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
        <p className="card-kicker">Unavailable session</p>
        <h2>Training session unavailable</h2>
        <p>The session for this dashboard entry is no longer available in local data.</p>
      </div>
      <button className="text-button destructive-button" type="button" onClick={onRemove}>
        Remove
      </button>
      <span className="sr-only">Entry {entry.id}</span>
    </article>
  );
}

interface DashboardTrainingSetProps {
  readonly entry: DashboardEntry;
  readonly index: number;
  readonly titleId?: string;
  readonly trainingSet: TrainingSet;
  readonly onRemove: () => void;
  readonly onUpdate: (patch: { readonly notes?: string }) => void;
  readonly onSetQuantity: (activityId: string, unit: TrainingQuantityUnit, value: number) => void;
  readonly onClearQuantity: (activityId: string, unit: TrainingQuantityUnit) => void;
  readonly onSetActivityNote: (activityId: string, note: string) => void;
}

export function DashboardTrainingSet({
  entry,
  index,
  titleId,
  trainingSet,
  onRemove,
  onUpdate,
  onSetQuantity,
  onClearQuantity,
  onSetActivityNote,
}: DashboardTrainingSetProps) {
  const [notesDraft, setNotesDraft] = useState(entry.notes);
  const [notesStatus, setNotesStatus] = useState<'idle' | 'updated'>('idle');
  const [saveConfirmationVersion, setSaveConfirmationVersion] = useState(0);
  const persistenceStatus = usePersistenceStatus();
  const activities = trainingSet.activities;
  const activityCount = getTrainingSetActivityCount(trainingSet);
  const description = getTrainingSetDescription(trainingSet);
  const headingId = titleId ?? `dashboard-entry-title-${entry.id}`;
  const saveHintId = `save-hint-${entry.id}`;
  const saveStatusId = `save-status-${entry.id}`;

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

  const handleExplicitSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && event.currentTarget.contains(activeElement)) {
      activeElement.blur();
    }

    setSaveConfirmationVersion((version) => version + 1);
  };

  useEffect(() => {
    if (saveConfirmationVersion === 0) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setSaveConfirmationVersion(0), 4_000);
    return () => window.clearTimeout(timeoutId);
  }, [saveConfirmationVersion]);

  return (
    <article className="dashboard-card dashboard-card--expanded" data-entry-index={index + 1}>
      <form className="dashboard-card-form" onSubmit={handleExplicitSave}>
        <div className="dashboard-card-heading">
          <div className="card-index" aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </div>
          <div className="card-content">
            <div className="library-card-topline">
              <TrainingSetTags trainingSet={trainingSet} />
              <span className="step-count">{activityCount} activities</span>
            </div>
            <h2 id={headingId}>{trainingSet.name}</h2>
            {description === undefined ? null : <p>{description}</p>}
            <div className="card-meta">
              <span>{entry.notes.length > 0 ? 'Has notes' : 'No notes yet'}</span>
            </div>
          </div>
          <button className="text-button destructive-button" type="button" onClick={onRemove}>
            Remove
          </button>
        </div>

        <div className="dashboard-sections detail-sections">
          <TrainingActivityList
            activities={activities}
            titleId={headingId}
            renderActivityAside={(context) =>
              renderDashboardActivity(context, {
                entry,
                onSetQuantity,
                onClearQuantity,
                onSetActivityNote,
              })
            }
          />
        </div>

        <div className="notes-field">
          <label htmlFor={`notes-${entry.id}`}>Practice notes</label>
          <textarea
            id={`notes-${entry.id}`}
            value={notesDraft}
            placeholder="What do you want to remember for this session?"
            rows={3}
            maxLength={TRAINING_DATA_LIMITS.noteCharacters}
            onBlur={handleNotesBlur}
            onChange={handleNotesChange}
          />
          <span className="field-status" role="status" aria-live="polite">
            {notesStatus === 'updated' ? getPersistenceUpdateLabel(persistenceStatus) : ''}
          </span>
        </div>

        <div className="dashboard-save-actions">
          <button
            className="primary-button"
            type="submit"
            aria-describedby={
              saveConfirmationVersion === 0 ? saveHintId : `${saveHintId} ${saveStatusId}`
            }
          >
            Save your changes
          </button>
          <div className="dashboard-save-feedback">
            <p id={saveHintId} className="dashboard-save-hint">
              Changes also save automatically when you leave a field.
            </p>
            <span id={saveStatusId} className="field-status" role="status" aria-live="polite">
              {saveConfirmationVersion > 0 ? (
                <span key={saveConfirmationVersion}>
                  {getExplicitPersistenceUpdateLabel(persistenceStatus)}
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </form>
    </article>
  );
}

interface DashboardTrainingSetCardProps {
  readonly entry: DashboardEntry;
  readonly trainingSet: TrainingSet;
  readonly onRemove: () => void;
  readonly onViewMore: () => void;
  readonly viewMoreButtonRef: (element: HTMLButtonElement | null) => void;
}

function DashboardTrainingSetCard({
  entry,
  trainingSet,
  onRemove,
  onViewMore,
  viewMoreButtonRef,
}: DashboardTrainingSetCardProps) {
  const activityCount = getTrainingSetActivityCount(trainingSet);
  const description = getTrainingSetDescription(trainingSet);

  return (
    <article className="dashboard-card dashboard-card--compact">
      <div className="library-card-topline">
        <TrainingSetTags trainingSet={trainingSet} />
        <span className="step-count">{activityCount} activities</span>
      </div>
      <h2>{trainingSet.name}</h2>
      {description === undefined ? null : <p className="library-card-description">{description}</p>}
      <div className="card-meta">
        <span>{entry.notes.length > 0 ? 'Has notes' : 'No notes yet'}</span>
      </div>
      <div className="library-card-actions">
        <button
          ref={viewMoreButtonRef}
          className="secondary-button"
          type="button"
          onClick={onViewMore}
        >
          View more
        </button>
        <button className="text-button destructive-button" type="button" onClick={onRemove}>
          Remove
        </button>
      </div>
    </article>
  );
}

interface DashboardActivityRenderOptions {
  readonly entry: DashboardEntry;
  readonly onSetQuantity: (activityId: string, unit: TrainingQuantityUnit, value: number) => void;
  readonly onClearQuantity: (activityId: string, unit: TrainingQuantityUnit) => void;
  readonly onSetActivityNote: (activityId: string, note: string) => void;
}

function renderDashboardActivity(
  context: TrainingActivityRenderContext,
  options: DashboardActivityRenderOptions,
) {
  const { activity, parentActivity } = context;
  const { entry, onSetQuantity, onClearQuantity, onSetActivityNote } = options;
  const activityUnits = getEditableTrainingQuantityUnits(entry, activity, parentActivity);
  const activityNoteEditor =
    activity.allowsSessionNotes === true ? (
      <ActivityNotesEditor entry={entry} activity={activity} onSet={onSetActivityNote} />
    ) : null;
  const editors =
    activityUnits.length === 0 ? null : (
      <QuantityEditors
        entry={entry}
        activity={activity}
        {...(parentActivity === undefined ? {} : { parentActivity })}
        onSet={onSetQuantity}
        onClear={onClearQuantity}
      />
    );
  return editors === null && activityNoteEditor === null ? null : (
    <>
      {editors}
      {activityNoteEditor}
    </>
  );
}

interface ActivityNotesEditorProps {
  readonly entry: DashboardEntry;
  readonly activity: TrainingActivity;
  readonly onSet: (activityId: string, note: string) => void;
}

function ActivityNotesEditor({ entry, activity, onSet }: ActivityNotesEditorProps) {
  const savedNote = entry.activityNotes[activity.id] ?? '';
  const [draft, setDraft] = useState(savedNote);
  const [isOpen, setIsOpen] = useState(savedNote.trim().length > 0);
  const [noteStatus, setNoteStatus] = useState<'idle' | 'updated'>('idle');
  const persistenceStatus = usePersistenceStatus();
  const baseId = `activity-notes-${entry.id}-${activity.id}`;
  const panelId = `${baseId}-panel`;
  const textareaId = `${baseId}-input`;
  const indicatorId = `${baseId}-indicator`;
  const statusId = `${baseId}-status`;
  const hasSavedNote = savedNote.trim().length > 0;

  const commit = (event: FocusEvent<HTMLTextAreaElement>) => {
    const nextNote = event.currentTarget.value;
    if (nextNote === savedNote) {
      setNoteStatus('idle');
      return;
    }
    onSet(activity.id, nextNote);
    if (nextNote.trim().length === 0) {
      setDraft('');
    }
    setNoteStatus('updated');
  };

  const statusMessage =
    noteStatus === 'updated' ? getPersistenceUpdateLabel(persistenceStatus) : '';

  return (
    <div className="activity-notes-editor">
      <div className="activity-notes-heading">
        <button
          className="activity-notes-toggle"
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-describedby={hasSavedNote ? indicatorId : undefined}
          onClick={() => setIsOpen((open) => !open)}
        >
          Any extra details?
        </button>
        {hasSavedNote ? (
          <span id={indicatorId} className="activity-notes-indicator">
            Note added
          </span>
        ) : null}
      </div>
      <div id={panelId} hidden={!isOpen} className="activity-notes-panel">
        <label htmlFor={textareaId}>Extra notes for {activity.name}</label>
        <textarea
          id={textareaId}
          value={draft}
          rows={2}
          maxLength={TRAINING_DATA_LIMITS.noteCharacters}
          aria-describedby={statusMessage.length > 0 ? statusId : undefined}
          placeholder="Add a note for this activity."
          onChange={(event) => {
            setDraft(event.target.value);
            setNoteStatus('idle');
          }}
          onBlur={commit}
        />
        <span id={statusId} className="field-status" role="status" aria-live="polite">
          {statusMessage}
        </span>
      </div>
    </div>
  );
}

interface QuantityEditorsProps {
  readonly entry: DashboardEntry;
  readonly activity: TrainingActivity;
  readonly parentActivity?: TrainingActivity;
  readonly onSet: (activityId: string, unit: TrainingQuantityUnit, value: number) => void;
  readonly onClear: (activityId: string, unit: TrainingQuantityUnit) => void;
}

function QuantityEditors({
  entry,
  activity,
  parentActivity,
  onSet,
  onClear,
}: QuantityEditorsProps) {
  const units = getEditableTrainingQuantityUnits(entry, activity, parentActivity);

  if (units.length === 0) {
    return null;
  }

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
  const limitHintId = `${inputId}-limit`;
  const unitLabel = formatQuantityUnit(unit, 2);
  const accessibleUnitLabel = `${unitLabel.charAt(0).toUpperCase()}${unitLabel.slice(1)}`;
  const defaultValue = getTrainingQuantityValue(activity, unit);
  const defaultHint =
    defaultValue !== undefined && isTrainingQuantityRange(defaultValue)
      ? ` Current suggested range: ${formatQuantityValue(defaultValue.min)}–${formatQuantityValue(
          defaultValue.max,
        )} ${unitLabel}.`
      : defaultValue === undefined
        ? ` ${accessibleUnitLabel} is not specified yet.`
        : '';
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
          placeholder="—"
          aria-describedby={
            feedbackMessage.length > 0 ? `${limitHintId} ${messageId}` : limitHintId
          }
          aria-invalid={feedback === 'invalid'}
          onChange={(event) => {
            const nextDraft = event.target.value;
            if (!hasAllowedQuantityDraftLength(nextDraft)) {
              return;
            }

            setDraft(nextDraft);
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
      <span id={limitHintId} className="sr-only">
        Enter no more than three digits.{defaultHint}
      </span>
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
