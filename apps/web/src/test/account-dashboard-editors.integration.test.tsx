import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { asTrainingSetId } from '@kendo-menu/domain';

import { DashboardPage } from '../features/dashboard/DashboardPage';
import { PersistenceContext } from '../features/persistence/persistence-context';
import { TrainingStoreProvider } from '../lib/training-store-context';
import { WorkspaceContextProvider } from '../lib/workspace-context';
import { createTestStore } from './test-utils';

const INTERNATIONAL_DOJO_ID = asTrainingSetId('international-dojo-2-hour-session');
const WARM_UP_ID = 'international-dojo-2-hour-session-warm-up-warm-up';
const KIRIKAESHI_ID = 'international-dojo-2-hour-session-kirikaeshi-kirikaeshi';

interface AccountDashboardHarnessProps {
  readonly editable: boolean;
  readonly dirty?: boolean;
  readonly store: ReturnType<typeof createTestStore>;
  readonly onEditorDraftDirtyChange: (dirty: boolean) => void;
  readonly saveState?: string;
  readonly download?: () => void;
  readonly saveToAccount?: () => Promise<void>;
  readonly flush?: () => Promise<void>;
}

function AccountDashboardHarness({
  editable,
  dirty = false,
  store,
  onEditorDraftDirtyChange,
  saveState,
  download,
  saveToAccount,
  flush = () => Promise.resolve(),
}: AccountDashboardHarnessProps) {
  const [editorDraftDirty, setEditorDraftDirty] = useState(false);

  return (
    <MemoryRouter initialEntries={['/app/account/dashboard']}>
      <WorkspaceContextProvider
        value={{
          kind: 'account',
          basePath: '/app/account',
          canEdit: editable,
          accountEmail: 'practitioner@example.test',
          isDirty: dirty,
          hasUncommittedEditorDraft: editorDraftDirty,
          ...(saveToAccount === undefined ? {} : { saveToAccount }),
          onEditorDraftDirtyChange: (dirty) => {
            setEditorDraftDirty(dirty);
            onEditorDraftDirtyChange(dirty);
          },
        }}
      >
        <PersistenceContext.Provider
          value={{
            mode: 'account',
            writeFailed: false,
            pending: false,
            flush,
            save: () => Promise.resolve(),
            downloadAllowed: !editorDraftDirty,
            ...(saveState === undefined ? {} : { saveState }),
            ...(download === undefined ? {} : { download }),
          }}
        >
          <TrainingStoreProvider store={store}>
            <DashboardPage />
          </TrainingStoreProvider>
        </PersistenceContext.Provider>
      </WorkspaceContextProvider>
    </MemoryRouter>
  );
}

function renderAccountDashboard(
  canEdit = true,
  onEditorDraftDirtyChange = vi.fn(),
  options: {
    readonly saveState?: string;
    readonly download?: () => void;
    readonly dirty?: boolean;
    readonly saveToAccount?: () => Promise<void>;
    readonly flush?: () => Promise<void>;
  } = {},
) {
  const store = createTestStore();
  store.getState().addToDashboard(INTERNATIONAL_DOJO_ID);

  const tree = (editable: boolean) => (
    <AccountDashboardHarness
      editable={editable}
      store={store}
      onEditorDraftDirtyChange={onEditorDraftDirtyChange}
      {...options}
    />
  );
  const view = render(tree(canEdit));

  return {
    store,
    hideAccountEditor: () => view.rerender(tree(false)),
    revealAccountEditor: () => view.rerender(tree(true)),
  };
}

async function openDashboardMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'View more' }));
  return screen.getByRole('dialog', { name: 'International dojo menu' });
}

function getActivity(activityId: string): HTMLElement {
  const activity = document.querySelector<HTMLElement>(`[data-activity-id="${activityId}"]`);
  if (activity === null) throw new Error(`Expected activity ${activityId}.`);
  return activity;
}

describe('account dashboard editor drafts', () => {
  it('matches the Library detail hierarchy and keeps Remove in the bottom action row', async () => {
    const user = userEvent.setup();
    renderAccountDashboard();
    const dialog = await openDashboardMenu(user);
    const title = within(dialog).getByRole('heading', {
      name: 'International dojo menu',
      level: 2,
    });
    const header = title.closest('header');
    if (header === null) throw new Error('Expected the dashboard detail header.');

    const tags = within(header).getByLabelText('Session tags');
    expect(tags.nextElementSibling).toBe(title);
    expect(header.querySelector('.page-intro')?.previousElementSibling).toBe(title);
    expect(header.nextElementSibling).toHaveClass('detail-meta');
    expect(header.nextElementSibling).toHaveTextContent('25 activities');
    expect(dialog.querySelector('.card-index')).toBeNull();

    const remove = within(dialog).getByRole('button', { name: 'Remove' });
    expect(remove).toHaveClass('dashboard-card-remove');
    expect(remove.parentElement).toHaveClass('dashboard-card-actions');
    expect(remove.parentElement?.lastElementChild).toBe(remove);
  });

  it('saves expanded account details through the existing whole-dashboard action', async () => {
    const user = userEvent.setup();
    const saveToAccount = vi.fn(() => Promise.resolve());
    const flush = vi.fn(() => Promise.resolve());
    const { store } = renderAccountDashboard(true, vi.fn(), {
      dirty: true,
      saveToAccount,
      flush,
    });
    const dialog = await openDashboardMenu(user);
    const saveButton = within(dialog).getByRole('button', { name: 'Save your changes' });
    const remove = within(dialog).getByRole('button', { name: 'Remove' });

    expect(saveButton).toBeEnabled();
    expect(remove.parentElement?.firstElementChild).toHaveClass('dashboard-card-save-group');
    expect(remove.parentElement?.lastElementChild).toBe(remove);

    const sessionNotes = within(dialog).getByLabelText('Practice notes');
    await user.type(sessionNotes, 'Saved from the expanded account menu.');
    await user.click(saveButton);

    expect(store.getState().dashboardEntries[0]?.notes).toBe(
      'Saved from the expanded account menu.',
    );
    expect(saveToAccount).toHaveBeenCalledOnce();
    expect(flush).not.toHaveBeenCalled();
  });

  it('keeps an invalid quantity draft out of an account save submitted from the menu', async () => {
    const user = userEvent.setup();
    const saveToAccount = vi.fn(() => Promise.resolve());
    renderAccountDashboard(true, vi.fn(), { dirty: true, saveToAccount });
    const dialog = await openDashboardMenu(user);
    const quantity = within(getActivity(KIRIKAESHI_ID)).getByLabelText(
      'Repetitions for Kirikaeshi',
    );
    await user.clear(quantity);
    await user.type(quantity, '501');
    const saveButton = within(dialog).getByRole('button', { name: 'Save your changes' });
    const form = saveButton.closest('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Expected the dashboard detail form.');

    fireEvent.submit(form);

    expect(quantity).toHaveAttribute('aria-invalid', 'true');
    expect(saveToAccount).not.toHaveBeenCalled();
  });

  it('commits whole-session notes before blur', async () => {
    const user = userEvent.setup();
    const { store } = renderAccountDashboard();
    const dialog = await openDashboardMenu(user);

    const sessionNotes = within(dialog).getByLabelText('Practice notes');
    await user.type(sessionNotes, 'Keep a calm pace.');

    expect(store.getState().dashboardEntries[0]?.notes).toBe('Keep a calm pace.');
  });

  it('commits activity notes before blur', async () => {
    const user = userEvent.setup();
    const { store } = renderAccountDashboard();
    const dialog = await openDashboardMenu(user);
    const warmUp = getActivity(WARM_UP_ID);
    await user.click(within(warmUp).getByRole('button', { name: 'Any extra details?' }));

    await user.type(
      within(warmUp).getByLabelText('Extra notes for Warm-up'),
      'Relax the shoulders.',
    );

    expect(store.getState().dashboardEntries[0]?.activityNotes[WARM_UP_ID]).toBe(
      'Relax the shoulders.',
    );
    expect(dialog).toBeVisible();
  });

  it('commits valid quantities before blur', async () => {
    const user = userEvent.setup();
    const { store } = renderAccountDashboard();
    const dialog = await openDashboardMenu(user);

    const quantity = within(getActivity(WARM_UP_ID)).getByLabelText('Minutes for Warm-up');
    await user.clear(quantity);
    await user.type(quantity, '12');

    expect(store.getState().dashboardEntries[0]?.quantityOverrides[WARM_UP_ID]?.minutes).toBe(12);
    expect(dialog).toBeVisible();
  });

  it('retains invalid and empty quantity drafts across account hide and reopen', async () => {
    const user = userEvent.setup();
    const editorDirty = vi.fn();
    const { store, hideAccountEditor, revealAccountEditor } = renderAccountDashboard(
      true,
      editorDirty,
    );
    await openDashboardMenu(user);

    const invalidQuantity = within(getActivity(KIRIKAESHI_ID)).getByLabelText(
      'Repetitions for Kirikaeshi',
    );
    fireEvent.change(invalidQuantity, { target: { value: '501' } });
    expect(store.getState().dashboardEntries[0]?.quantityOverrides[KIRIKAESHI_ID]).toBeUndefined();
    expect(editorDirty).toHaveBeenLastCalledWith(true);

    hideAccountEditor();
    revealAccountEditor();
    await openDashboardMenu(user);
    const restoredInvalid = within(getActivity(KIRIKAESHI_ID)).getByLabelText(
      'Repetitions for Kirikaeshi',
    );
    expect(restoredInvalid).toHaveValue(501);
    expect(restoredInvalid).toHaveAttribute('aria-invalid', 'true');

    await user.clear(restoredInvalid);
    expect(editorDirty).toHaveBeenLastCalledWith(true);
    hideAccountEditor();
    revealAccountEditor();
    await openDashboardMenu(user);
    expect(
      within(getActivity(KIRIKAESHI_ID)).getByLabelText('Repetitions for Kirikaeshi'),
    ).toHaveValue(null);
    expect(store.getState().dashboardEntries[0]?.quantityOverrides[KIRIKAESHI_ID]).toBeUndefined();

    const restoredEmpty = within(getActivity(KIRIKAESHI_ID)).getByLabelText(
      'Repetitions for Kirikaeshi',
    );
    fireEvent.change(restoredEmpty, { target: { value: '400' } });
    expect(
      store.getState().dashboardEntries[0]?.quantityOverrides[KIRIKAESHI_ID]?.repetitions,
    ).toBe(400);
    expect(editorDirty).toHaveBeenLastCalledWith(false);

    await user.clear(restoredEmpty);
    await user.tab();
    expect(store.getState().dashboardEntries[0]?.quantityOverrides[KIRIKAESHI_ID]).toBeUndefined();
    expect(editorDirty).toHaveBeenLastCalledWith(false);
  });

  it('clears an unfinished quantity and its warning when the entry is removed', async () => {
    const user = userEvent.setup();
    const editorDirty = vi.fn();
    const { store } = renderAccountDashboard(true, editorDirty);
    const dialog = await openDashboardMenu(user);
    fireEvent.change(
      within(getActivity(KIRIKAESHI_ID)).getByLabelText('Repetitions for Kirikaeshi'),
      {
        target: { value: '501' },
      },
    );
    expect(editorDirty).toHaveBeenLastCalledWith(true);

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(store.getState().dashboardEntries).toHaveLength(0);
    expect(editorDirty).toHaveBeenLastCalledWith(false);
  });

  it('blocks an incomplete quantity draft download until the field is valid', async () => {
    const user = userEvent.setup();
    const download = vi.fn();
    renderAccountDashboard(true, vi.fn(), { saveState: 'conflict', download });
    await openDashboardMenu(user);

    const quantity = within(getActivity(KIRIKAESHI_ID)).getByLabelText(
      'Repetitions for Kirikaeshi',
    );
    fireEvent.change(quantity, { target: { value: '501' } });

    const downloadButton = screen.getByRole('button', { name: 'Download draft' });
    expect(downloadButton).toBeDisabled();
    expect(
      screen.getByText(/complete or clear the unfinished quantity field before downloading/i),
    ).toBeVisible();
    await user.click(downloadButton);
    expect(download).not.toHaveBeenCalled();

    await user.clear(quantity);
    await user.type(quantity, '400');
    expect(downloadButton).toBeEnabled();
    await user.click(downloadButton);
    expect(download).toHaveBeenCalledOnce();
  });
});
