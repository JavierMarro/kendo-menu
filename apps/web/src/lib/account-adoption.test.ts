import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_DASHBOARD_REQUEST_BYTES } from './account-api';
import {
  createGuestCopyRequest,
  guestCopyFitsRequestLimit,
  readGuestCopySnapshot,
} from './account-adoption';
import { GUEST_WORKSPACE_LOCK_NAME, type WorkspaceLockProvider } from './workspace-coordination';

const ACCOUNT = '01234567-89ab-4cde-8fab-0123456789ab';
const OPPORTUNITY = '01234567-89ab-4cde-8fab-0123456789ad';
const REQUEST = '01234567-89ab-4cde-8fab-0123456789ae';
const handoff = { accountId: ACCOUNT, email: null, created: true, copyOpportunityId: OPPORTUNITY };
const catalogueVersion = 'a'.repeat(64);

function entry(index = 0, note = '  guest note 界  ', description = '') {
  return {
    id: `entry-${index}`,
    trainingSetId: `custom-${index}`,
    trainingSet: {
      id: `custom-${index}`,
      name: 'Guest session',
      description,
      category: 'custom',
      isBuiltIn: false,
      sections: [
        {
          id: 'section',
          name: 'Kamae',
          exercises: [
            {
              id: 'exercise',
              name: 'Suburi',
              quantities: { repetitions: 12 },
              notes: 'exercise notes',
            },
          ],
        },
      ],
    },
    quantityOverrides: { exercise: { repetitions: 0 } },
    activityNotes: {},
    notes: note,
    createdAt: '2026-10-10T10:00:00.000Z',
  };
}
function builtInEntry(index = 0, note = '  activity note 界  ') {
  const trainingSet = DEFAULT_TRAINING_SETS.find((set) =>
    set.activities.some((activity) => activity.allowsSessionNotes),
  );
  const activity = trainingSet?.activities.find((value) => value.allowsSessionNotes);
  if (trainingSet === undefined || activity === undefined)
    throw new Error('Expected curated note activity.');
  return {
    id: `built-in-${index}`,
    trainingSetId: trainingSet.id,
    quantityOverrides: {},
    activityNotes: { [activity.id]: note },
    notes: note,
    createdAt: '2026-10-10T10:00:00.000Z',
  };
}
function seed(entries: readonly unknown[] = [entry(), builtInEntry()]): string {
  const raw = JSON.stringify({ state: { dashboardEntries: entries }, version: 10 });
  localStorage.setItem('kendo-menu', raw);
  return raw;
}
const lockNames: string[] = [];
beforeEach(() => {
  localStorage.clear();
  lockNames.length = 0;
  const locks: WorkspaceLockProvider = {
    request: async (name, callback) => {
      lockNames.push(name);
      return callback({ name, mode: 'exclusive' });
    },
  };
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
});
afterEach(() => vi.restoreAllMocks());

describe('complete read-only guest copy snapshot', () => {
  it('preserves exact source bytes and all IDs, notes and zero overrides under the guest lock', async () => {
    const raw = seed();
    const writes = vi.spyOn(localStorage, 'setItem');
    const removes = vi.spyOn(localStorage, 'removeItem');
    const snapshot = await readGuestCopySnapshot();
    expect(snapshot).not.toBeNull();
    if (snapshot === null) throw new Error('Expected complete guest snapshot.');
    expect(snapshot.raw).toBe(raw);
    expect(snapshot.entryCount).toBe(2);
    expect(snapshot.dashboard.state.dashboardEntries).toEqual([entry(), builtInEntry()]);
    const request = createGuestCopyRequest({
      accountId: ACCOUNT,
      handoff,
      catalogueVersion,
      snapshot,
      requestId: REQUEST,
    });
    expect(request).toMatchObject({
      decision: 'yes',
      expectedRevision: '0',
      copyOpportunityId: OPPORTUNITY,
      requestId: REQUEST,
      dashboard: snapshot.dashboard,
    });
    expect(lockNames).toEqual([GUEST_WORKSPACE_LOCK_NAME]);
    expect(localStorage.getItem('kendo-menu')).toBe(raw);
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
  });

  it.each([
    null,
    '',
    '{broken',
    '{"version":10,"state":{"dashboardEntries":[]}}',
    '{"version":11,"state":{"dashboardEntries":[]}}',
    'x'.repeat(MAX_DASHBOARD_REQUEST_BYTES + 1),
  ])(
    'skips absent, empty, corrupt, future or oversized data without changing it (%#)',
    async (raw) => {
      if (raw !== null) localStorage.setItem('kendo-menu', raw);
      const writes = vi.spyOn(localStorage, 'setItem');
      expect(await readGuestCopySnapshot()).toBeNull();
      expect(localStorage.getItem('kendo-menu')).toBe(raw);
      expect(writes).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid current notes instead of silently copying a sanitized subset', async () => {
    const raw = seed([{ ...entry(), activityNotes: { exercise: 'must not be silently lost' } }]);
    expect(await readGuestCopySnapshot()).toBeNull();
    expect(localStorage.getItem('kendo-menu')).toBe(raw);
  });

  it('skips unreadable storage or unavailable coordination', async () => {
    seed();
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('unreadable');
    });
    expect(await readGuestCopySnapshot()).toBeNull();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    expect(await readGuestCopySnapshot()).toBeNull();
  });

  it('rejects returning, missing-opportunity and mismatched creation handoffs', async () => {
    seed();
    const snapshot = await readGuestCopySnapshot();
    if (snapshot === null) throw new Error('Expected snapshot.');
    for (const invalidHandoff of [
      { ...handoff, created: false },
      { accountId: ACCOUNT, email: null, created: true },
      { ...handoff, accountId: REQUEST },
    ]) {
      expect(
        createGuestCopyRequest({
          accountId: ACCOUNT,
          handoff: invalidHandoff,
          catalogueVersion,
          snapshot,
          requestId: REQUEST,
        }),
      ).toBeNull();
    }
  });

  it('measures the complete UTF-8 envelope even when the stored snapshot fits', async () => {
    const entries = Array.from({ length: 50 }, (_, index) => builtInEntry(index, ''));
    const emptyBytes = new TextEncoder().encode(seed(entries)).byteLength;
    const targetBytes = MAX_DASHBOARD_REQUEST_BYTES - 100;
    const noteLength = Math.floor((targetBytes - emptyBytes) / (50 * 6));
    const large = entries.map((value) => ({
      ...value,
      notes: '界'.repeat(noteLength),
      activityNotes: Object.fromEntries(
        Object.keys(value.activityNotes).map((key) => [key, '界'.repeat(noteLength)]),
      ),
    }));
    const last = large[49];
    if (last === undefined) throw new Error('Expected fixture entry.');
    const remainder = targetBytes - new TextEncoder().encode(seed(large)).byteLength;
    large[49] = {
      ...last,
      notes: last.notes + 'x'.repeat(remainder),
    };
    const raw = seed(large);
    expect(new TextEncoder().encode(raw).byteLength).toBe(targetBytes);
    const snapshot = await readGuestCopySnapshot();
    if (snapshot === null) throw new Error('Expected valid source within storage byte limit.');
    expect(
      guestCopyFitsRequestLimit({ accountId: ACCOUNT, handoff, catalogueVersion, snapshot }),
    ).toBe(false);
    expect(localStorage.getItem('kendo-menu')).toBe(raw);
  });
});
