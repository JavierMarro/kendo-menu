import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createTestStore } from '../../test/test-utils';
import { WorkspaceContextProvider } from '../../lib/workspace-context-provider';
import type { WorkspaceContextValue } from '../../lib/workspace-context';
import { ShareMenuButton } from './ShareMenuButton';

function fixture(overrides: Partial<WorkspaceContextValue> = {}) {
  const store = createTestStore();
  const { dashboardEntry: entry } = store.getState().createCustomTrainingSetAndAddToDashboard({
    name: 'My keiko',
    category: 'custom',
    sections: [{ name: 'Main', exercises: [{ name: 'Men' }] }],
  });
  const createMenuShare = vi
    .fn<NonNullable<WorkspaceContextValue['createMenuShare']>>()
    .mockResolvedValue({
      token: 's'.repeat(43),
      sourceRevision: '1',
      accountWorkspaceId: 'account',
    });
  const value: WorkspaceContextValue = {
    kind: 'account',
    basePath: '/app/account',
    canEdit: true,
    accountEmail: null,
    canShare: true,
    getSavedEntry: () => entry,
    createMenuShare,
    ...overrides,
  };
  render(
    <WorkspaceContextProvider value={value}>
      <ShareMenuButton entry={entry} />
    </WorkspaceContextProvider>,
  );
  return { entry, createMenuShare };
}

describe('Share it action', () => {
  it('does not offer sharing to guests', () => {
    fixture({ kind: 'guest', basePath: '/app/guest' });
    expect(screen.queryByRole('button', { name: 'Share it!' })).not.toBeInTheDocument();
  });
  it('requires a saved custom menu before creating a link', async () => {
    const user = userEvent.setup();
    const { createMenuShare } = fixture({ getSavedEntry: () => null });
    await user.click(screen.getByRole('button', { name: 'Share it!' }));
    expect(screen.getByText('Save this menu to your account before sharing it.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create sharing link' })).not.toBeInTheDocument();
    expect(createMenuShare).not.toHaveBeenCalled();
  });
  it('explains the saved snapshot and presents a copyable link, restoring focus on close', async () => {
    const user = userEvent.setup();
    const { createMenuShare, entry } = fixture();
    const trigger = screen.getByRole('button', { name: 'Share it!' });
    await user.click(trigger);
    expect(screen.getByText(/This shares your last saved version/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Create sharing link' }));
    expect(await screen.findByRole('textbox', { name: 'Sharing link' })).toHaveValue(
      `${window.location.origin}/share/${'s'.repeat(43)}`,
    );
    expect(screen.getByRole('textbox', { name: 'Sharing link' })).toHaveFocus();
    expect(createMenuShare).toHaveBeenCalledWith(entry.id, expect.any(AbortSignal));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(screen.getByRole('status')).toHaveTextContent('Link copied.');
    await user.click(screen.getByRole('button', { name: 'Close sharing' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
