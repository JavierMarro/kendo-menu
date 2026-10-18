import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AccountSaveStatus, AccountUnsavedWarning } from './AccountUnsavedWarning';

const AUTHORITATIVE_CLEAN_DRAFT = {
  isAuthoritative: true,
  isDirty: false,
  hasUncommittedEditorDraft: false,
  hasUncommittedBuilderDraft: false,
  saveState: 'idle' as const,
};

describe('account save status', () => {
  it('uses the saved state only for a clean authoritative account draft', () => {
    render(<AccountSaveStatus {...AUTHORITATIVE_CLEAN_DRAFT} />);

    const status = screen.getByRole('status', {
      name: 'Cloud save status: Saved on the cloud',
    });
    expect(status).toHaveClass('is-saved');
    expect(status.querySelector('.account-cloud-save-dot')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows a confirmed save only while the authoritative dashboard is available', () => {
    render(<AccountSaveStatus {...AUTHORITATIVE_CLEAN_DRAFT} saveState="saved" />);
    expect(
      screen.getByRole('status', { name: 'Cloud save status: Saved on the cloud' }),
    ).toHaveClass('is-saved');
  });

  it.each([
    [{ isDirty: true }, 'Unsaved account changes'],
    [{ hasUncommittedBuilderDraft: true }, 'Unsaved account changes'],
    [{ hasUncommittedEditorDraft: true }, 'Quantity field not saved'],
    [{ saveState: 'saving' }, 'Saving to account…'],
    [{ saveState: 'uncertain' }, 'Save status uncertain'],
    [{ saveState: 'conflict' }, 'Save needs attention'],
    [{ isAuthoritative: false }, 'Account status not confirmed'],
    [{ isAuthoritative: false, saveState: 'saved' }, 'Account status not confirmed'],
  ] as const)('keeps %s visibly distinct from saved', (overrides, label) => {
    render(<AccountSaveStatus {...AUTHORITATIVE_CLEAN_DRAFT} {...overrides} />);

    const status = screen.getByRole('status', { name: `Cloud save status: ${label}` });
    expect(status).not.toHaveClass('is-saved');
    expect(status).toHaveTextContent(label);
  });
});

describe('account unsaved warning', () => {
  it('keeps uncertainty and incomplete-field meaning while guarding draft download', () => {
    const view = render(
      <AccountUnsavedWarning
        isDirty={false}
        hasUncommittedEditorDraft={false}
        saveState="uncertain"
        onDownload={() => undefined}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Save status is uncertain. Retry the same save.',
    );
    expect(screen.getByRole('button', { name: 'Download draft' })).toBeEnabled();

    view.rerender(
      <AccountUnsavedWarning
        isDirty={false}
        hasUncommittedEditorDraft
        saveState="idle"
        onDownload={() => undefined}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      /held only in this tab, not in the account draft/u,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/complete or clear it before leaving/iu);
    expect(screen.queryByRole('button', { name: 'Download draft' })).not.toBeInTheDocument();
  });
});
