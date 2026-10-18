import type { AccountDraftSnapshot } from '../../lib/account-draft';

/** Keeps the same account-draft warning beside the active task on each workspace page. */
interface AccountUnsavedWarningProps {
  readonly isDirty: boolean;
  readonly hasUncommittedEditorDraft: boolean;
  readonly saveState: string;
  readonly onDownload: (() => void) | undefined;
  readonly className?: string;
}

export function AccountUnsavedWarning({
  isDirty,
  hasUncommittedEditorDraft,
  saveState,
  onDownload,
  className,
}: AccountUnsavedWarningProps) {
  if (!isDirty && !hasUncommittedEditorDraft && saveState !== 'uncertain') return null;

  return (
    <aside
      className={`persistence-warning account-unsaved-warning${className ? ` ${className}` : ''}`}
      role="status"
    >
      <p>
        {saveState === 'uncertain'
          ? 'Save status is uncertain. Retry the same save.'
          : hasUncommittedEditorDraft
            ? 'An unfinished quantity field is held only in this tab, not in the account draft. Complete or clear it before leaving; closing or reloading can lose it.'
            : 'Unsaved account changes exist only in this tab; closing or reloading can lose them.'}
      </p>
      {!hasUncommittedEditorDraft ? (
        <button
          className="secondary-button"
          type="button"
          onClick={onDownload}
          disabled={onDownload === undefined}
        >
          Download draft
        </button>
      ) : null}
    </aside>
  );
}

interface AccountSaveStatusProps {
  readonly isAuthoritative: boolean;
  readonly isDirty: boolean;
  readonly hasUncommittedEditorDraft: boolean;
  readonly hasUncommittedBuilderDraft: boolean;
  readonly saveState: AccountDraftSnapshot['saveState'];
}

export function AccountSaveStatus({
  isAuthoritative,
  isDirty,
  hasUncommittedEditorDraft,
  hasUncommittedBuilderDraft,
  saveState,
}: AccountSaveStatusProps) {
  const isSaved =
    isAuthoritative &&
    !isDirty &&
    !hasUncommittedEditorDraft &&
    !hasUncommittedBuilderDraft &&
    (saveState === 'idle' || saveState === 'saved');
  const label =
    saveState === 'uncertain'
      ? 'Save status uncertain'
      : saveState === 'saving'
        ? 'Saving to account…'
        : saveState === 'conflict' || saveState === 'blocked'
          ? 'Save needs attention'
          : hasUncommittedEditorDraft
            ? 'Quantity field not saved'
            : isDirty || hasUncommittedBuilderDraft
              ? 'Unsaved account changes'
              : isAuthoritative
                ? 'Saved on the cloud'
                : 'Account status not confirmed';

  return (
    <div
      className={`session-status account-cloud-save-status${isSaved ? ' is-saved' : ''}`}
      role="status"
      aria-label={`Cloud save status: ${label}`}
    >
      <span className="account-cloud-save-dot" aria-hidden="true" />
      <span className="session-status-label">{label}</span>
    </div>
  );
}
