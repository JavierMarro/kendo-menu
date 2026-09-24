import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { createTrainingStore, serializePersistedTrainingStateV10 } from '@kendo-menu/store';
import { describe, expect, it } from 'vitest';

import {
  inspectGuestAdoptionEligibility,
  withAccountSynchronizationLock,
  type AccountSynchronizationLockProvider,
} from './account-synchronization';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const CATALOGUE_VERSION = 'a'.repeat(64);

describe('account synchronization boundaries', () => {
  it('offers adoption only for a complete non-empty validated guest dashboard', () => {
    const values = new Map<string, string>();
    const guest = createTrainingStore({
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
        removeItem: (key) => {
          values.delete(key);
        },
      },
    });
    const set = DEFAULT_TRAINING_SETS[0];
    if (set === undefined) throw new Error('Missing training set fixture');
    guest.getState().addToDashboard(set.id);
    const raw = values.get('kendo-menu') ?? null;
    expect(inspectGuestAdoptionEligibility(raw, ACCOUNT_ID, CATALOGUE_VERSION).status).toBe(
      'eligible',
    );

    for (const value of [
      null,
      '{broken',
      JSON.stringify({ version: 11, state: {} }),
      serializePersistedTrainingStateV10({ dashboardEntries: [] }),
    ]) {
      expect(inspectGuestAdoptionEligibility(value, ACCOUNT_ID, CATALOGUE_VERSION)).toEqual({
        status: 'ineligible',
      });
    }

    const entry = guest.getState().dashboardEntries[0];
    if (entry === undefined) throw new Error('Missing dashboard entry fixture');
    const unicodeHeavy = serializePersistedTrainingStateV10({
      dashboardEntries: Array.from({ length: 128 }, (_, index) => ({
        ...entry,
        id: `${entry.id}-${index}`,
        notes: '€'.repeat(8_000),
      })),
    });
    expect(unicodeHeavy.length).toBeLessThanOrEqual(2_097_152);
    expect(inspectGuestAdoptionEligibility(unicodeHeavy, ACCOUNT_ID, CATALOGUE_VERSION)).toEqual({
      status: 'ineligible',
    });
  });

  it('uses a distinct nonblocking sync lock and leaves work paused when it is unavailable', async () => {
    const names: string[] = [];
    let runs = 0;
    const locks: AccountSynchronizationLockProvider = {
      request: async (name, options, callback) => {
        names.push(name);
        expect(options).toEqual({ mode: 'exclusive', ifAvailable: true });
        return callback({ name, mode: 'exclusive' });
      },
    };
    const operation = () => {
      runs += 1;
      return 'saved';
    };
    expect(await withAccountSynchronizationLock(ACCOUNT_ID, operation, locks)).toEqual({
      status: 'acquired',
      value: 'saved',
    });
    expect(names).toEqual([`kendo-menu:account:${ACCOUNT_ID}:sync`]);

    const occupied: AccountSynchronizationLockProvider = {
      request: async (_name, _options, callback) => callback(null),
    };
    expect(await withAccountSynchronizationLock(ACCOUNT_ID, operation, occupied)).toEqual({
      status: 'unavailable',
    });
    expect(await withAccountSynchronizationLock(ACCOUNT_ID, operation, null)).toEqual({
      status: 'unavailable',
    });
    expect(runs).toBe(1);
  });
});
