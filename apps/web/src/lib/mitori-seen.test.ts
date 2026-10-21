import { describe, expect, it } from 'vitest';

import { MITORI_VIDEOS } from '../features/mitori/mitori-videos';
import { MITORI_SEEN_STORAGE_KEY, persistMitoriSeenIds, readMitoriSeenState } from './mitori-seen';

const MITORI_VIDEO_IDS = new Set(
  Object.values(MITORI_VIDEOS)
    .flat()
    .map(({ id }) => id),
);

describe('Mitori seen marks', () => {
  it('round-trips supported video IDs and allows unmarking', () => {
    const videoId = MITORI_VIDEOS.techniques[0]?.id;
    if (videoId === undefined) throw new Error('Expected a Mitori video fixture.');

    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(persistMitoriSeenIds(() => storage, new Set([videoId]), MITORI_VIDEO_IDS)).toBe(true);
    expect(readMitoriSeenState(() => storage, MITORI_VIDEO_IDS)).toEqual({
      seenVideoIds: new Set([videoId]),
      canPersist: true,
    });
    expect(persistMitoriSeenIds(() => storage, new Set(), MITORI_VIDEO_IDS)).toBe(true);
    expect(readMitoriSeenState(() => storage, MITORI_VIDEO_IDS).seenVideoIds.size).toBe(0);
    expect(values.has(MITORI_SEEN_STORAGE_KEY)).toBe(true);
  });

  it('ignores malformed, oversized, unknown-version, and unknown-ID data', () => {
    let raw: string | null = '{';
    const storage = { getItem: () => raw };

    expect(readMitoriSeenState(() => storage, MITORI_VIDEO_IDS).seenVideoIds.size).toBe(0);
    expect(readMitoriSeenState(() => storage, MITORI_VIDEO_IDS).canPersist).toBe(true);
    raw = ' '.repeat(2_049);
    expect(readMitoriSeenState(() => storage, MITORI_VIDEO_IDS).seenVideoIds.size).toBe(0);
    raw = JSON.stringify({ version: 2, seenVideoIds: ['YboQmxKTci4'] });
    expect(readMitoriSeenState(() => storage, MITORI_VIDEO_IDS).seenVideoIds.size).toBe(0);
    raw = JSON.stringify({ version: 1, seenVideoIds: ['removed-video'] });
    expect(readMitoriSeenState(() => storage, MITORI_VIDEO_IDS).seenVideoIds.size).toBe(0);
    expect(
      persistMitoriSeenIds(
        () => ({ getItem: () => null, setItem: () => undefined }),
        new Set(['removed-video']),
        MITORI_VIDEO_IDS,
      ),
    ).toBe(false);
  });

  it('keeps recognized marks when a bounded record contains extra or duplicate IDs', () => {
    const videoId = 'YboQmxKTci4';
    const raw = JSON.stringify({
      version: 1,
      seenVideoIds: [
        ...Array.from({ length: MITORI_VIDEO_IDS.size + 1 }, () => videoId),
        'removed',
      ],
    });

    expect(readMitoriSeenState(() => ({ getItem: () => raw }), MITORI_VIDEO_IDS)).toEqual({
      seenVideoIds: new Set([videoId]),
      canPersist: true,
    });
  });

  it('preserves oversized and unsupported-version records but replaces malformed JSON on a mark', () => {
    const videoId = MITORI_VIDEOS.techniques[0]?.id;
    if (videoId === undefined) throw new Error('Expected a Mitori video fixture.');

    let raw = JSON.stringify({ version: 2, seenVideoIds: ['YboQmxKTci4'] });
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    };
    const futureRecord = raw;

    expect(readMitoriSeenState(() => storage, MITORI_VIDEO_IDS).canPersist).toBe(false);
    expect(persistMitoriSeenIds(() => storage, new Set([videoId]), MITORI_VIDEO_IDS)).toBe(false);
    expect(raw).toBe(futureRecord);

    raw = ' '.repeat(2_049);
    const oversizedRecord = raw;
    expect(readMitoriSeenState(() => storage, MITORI_VIDEO_IDS).canPersist).toBe(false);
    expect(persistMitoriSeenIds(() => storage, new Set([videoId]), MITORI_VIDEO_IDS)).toBe(false);
    expect(raw).toBe(oversizedRecord);

    raw = '{';
    expect(persistMitoriSeenIds(() => storage, new Set([videoId]), MITORI_VIDEO_IDS)).toBe(true);
    expect(readMitoriSeenState(() => storage, MITORI_VIDEO_IDS).seenVideoIds).toEqual(
      new Set([videoId]),
    );
  });

  it('keeps the page usable when storage access fails', () => {
    const unavailable = {
      getItem: () => {
        throw new Error('Storage blocked');
      },
      setItem: () => {
        throw new Error('Storage blocked');
      },
    };

    expect(readMitoriSeenState(() => unavailable, MITORI_VIDEO_IDS)).toEqual({
      seenVideoIds: new Set(),
      canPersist: false,
    });
    expect(persistMitoriSeenIds(() => unavailable, new Set(), MITORI_VIDEO_IDS)).toBe(false);
  });
});
