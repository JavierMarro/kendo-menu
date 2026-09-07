import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { classifyTrainingStorageValue } from '@kendo-menu/store';

import { PersistenceGate, usePersistenceStatus } from '../features/persistence/PersistenceGate';
import { useTrainingStore, useTrainingStoreApi } from '../lib/training-store-context';
import * as persistence from '../lib/training-persistence';

function EditProbe() {
  const store = useTrainingStoreApi();
  const note = useTrainingStore((state) => state.dashboardEntries[0]?.notes ?? 'Empty');
  const status = usePersistenceStatus();
  return (
    <>
      <p>{note}</p>
      <p>{status.writeFailed ? 'Unsaved' : status.mode}</p>
      <button
        onClick={() => {
          const trainingSet = DEFAULT_TRAINING_SETS[0];
          if (trainingSet === undefined) throw new Error('Missing built-in fixture.');
          const id = store.getState().addToDashboard(trainingSet.id);
          store.getState().updateDashboardEntry(id, { notes: 'Latest in-memory notes' });
        }}
      >
        Make edits
      </button>
    </>
  );
}

function setupFailedWrites() {
  const write = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError');
  });
  render(
    <PersistenceGate>
      <EditProbe />
    </PersistenceGate>,
  );
  return write;
}

describe('live-state recovery transitions', () => {
  it('retains edits after failed retries and explicitly switches to session-only mode', async () => {
    const user = userEvent.setup();
    const write = setupFailedWrites();
    await user.click(screen.getByRole('button', { name: 'Make edits' }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Latest in-memory notes')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open recovery options' }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(write).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Latest in-memory notes')).toBeVisible();
    expect(screen.getByText('Unsaved')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open recovery options' }));
    await user.click(screen.getByRole('button', { name: 'Continue without saving' }));
    expect(screen.getByText('Latest in-memory notes')).toBeVisible();
    expect(screen.getByText('session')).toBeVisible();
    expect(write).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(persistence.TRAINING_STORAGE_KEY)).toBeNull();
  });

  it('persists the latest live state only when the user explicitly retries', async () => {
    const user = userEvent.setup();
    const write = setupFailedWrites();
    await user.click(screen.getByRole('button', { name: 'Make edits' }));
    write.mockRestore();
    expect(window.localStorage.getItem(persistence.TRAINING_STORAGE_KEY)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open recovery options' }));
    expect(window.localStorage.getItem(persistence.TRAINING_STORAGE_KEY)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const raw = window.localStorage.getItem(persistence.TRAINING_STORAGE_KEY);
    expect(classifyTrainingStorageValue(raw)).toMatchObject({ status: 'ready' });
    expect(raw).toContain('Latest in-memory notes');
    expect(screen.getByText('local')).toBeVisible();
    expect(screen.queryByText('Unsaved')).not.toBeInTheDocument();
  });

  it.each(['{corrupt', '{"version":999,"state":{}}'])(
    'keeps protected bytes and live edits when retry discovers %s',
    async (raw) => {
      const user = userEvent.setup();
      const write = setupFailedWrites();
      await user.click(screen.getByRole('button', { name: 'Make edits' }));
      write.mockRestore();
      window.localStorage.setItem(persistence.TRAINING_STORAGE_KEY, raw);
      const download = vi
        .spyOn(persistence, 'downloadCurrentTrainingBackup')
        .mockImplementation(() => undefined);
      await user.click(screen.getByRole('button', { name: 'Open recovery options' }));
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await user.click(screen.getByRole('button', { name: 'Download current backup' }));
      expect(download).toHaveBeenCalledWith([
        expect.objectContaining({ notes: 'Latest in-memory notes' }),
      ]);
      expect(window.localStorage.getItem(persistence.TRAINING_STORAGE_KEY)).toBe(raw);
      await user.click(screen.getByRole('button', { name: 'Continue without saving' }));
      expect(screen.getByText('Latest in-memory notes')).toBeVisible();
      expect(screen.getByText('session')).toBeVisible();
      expect(window.localStorage.getItem(persistence.TRAINING_STORAGE_KEY)).toBe(raw);
    },
  );

  it('reports storage unavailability after an explicit successful reset without claiming nothing changed', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(persistence.TRAINING_STORAGE_KEY, '{corrupt');
    const read = window.localStorage.getItem.bind(window.localStorage);
    render(
      <PersistenceGate>
        <EditProbe />
      </PersistenceGate>,
    );
    await user.click(screen.getByRole('button', { name: 'Reset local data' }));
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Read blocked after removal');
    });
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reset local data' }),
    );
    expect(read(persistence.TRAINING_STORAGE_KEY)).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'KendoMenu cannot access local data.' }),
    ).toBeVisible();
    expect(screen.queryByText(/Nothing was changed/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue without saving' }));
    expect(await screen.findByText('Empty')).toBeVisible();
  });

  it('announces a current-backup failure while retaining the live state', async () => {
    const user = userEvent.setup();
    setupFailedWrites();
    vi.spyOn(persistence, 'downloadCurrentTrainingBackup').mockImplementation(() => {
      throw new Error('Private exception value');
    });
    await user.click(screen.getByRole('button', { name: 'Make edits' }));
    await user.click(screen.getByRole('button', { name: 'Download current backup' }));
    expect(screen.getByText(/could not download the current backup/)).toHaveAttribute(
      'role',
      'alert',
    );
    expect(screen.queryByText('Private exception value')).not.toBeInTheDocument();
    expect(screen.getByText('Latest in-memory notes')).toBeVisible();
  });
});
