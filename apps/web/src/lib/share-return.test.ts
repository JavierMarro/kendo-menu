import { describe, expect, it } from 'vitest';

import {
  consumeShareReturnMarker,
  isShareToken,
  readShareReturnMarker,
  SHARE_RETURN_KEY,
  SHARE_RETURN_TTL_MS,
  shareReturnPath,
  writeShareReturnMarker,
} from './share-return';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const token = 'A'.repeat(43);

describe('share sign-in continuation', () => {
  it('accepts only opaque share tokens and builds a fixed destination', () => {
    expect(isShareToken(token)).toBe(true);
    expect(isShareToken('../account')).toBe(false);
    expect(shareReturnPath(token)).toBe(`/app/account/shared/${token}`);
    expect(shareReturnPath('https://evil.example')).toBeNull();
  });

  it('writes a bounded per-tab marker and consumes it once', () => {
    const target = storage();
    expect(writeShareReturnMarker(token, target, 100)).toBe(true);
    expect(readShareReturnMarker(target, 101)).toEqual({
      version: 1,
      token,
      expiresAt: 100 + SHARE_RETURN_TTL_MS,
    });
    expect(consumeShareReturnMarker(target, 101)).toBe(`/app/account/shared/${token}`);
    expect(consumeShareReturnMarker(target, 102)).toBeNull();
  });

  it('rejects malformed, extended and expired markers and clears them', () => {
    const target = storage();
    for (const marker of [
      { version: 1, token: '../', expiresAt: 20 },
      { version: 1, token, expiresAt: 20, redirect: '/admin' },
      { version: 1, token, expiresAt: 1_000 + SHARE_RETURN_TTL_MS + 1 },
    ]) {
      target.setItem(SHARE_RETURN_KEY, JSON.stringify(marker));
      expect(consumeShareReturnMarker(target, 1_000)).toBeNull();
      expect(target.getItem(SHARE_RETURN_KEY)).toBeNull();
    }
    expect(writeShareReturnMarker('../', target)).toBe(false);
  });

  it('fails closed when storage cannot write', () => {
    const unavailable = {
      getItem: () => null,
      setItem: () => {
        throw new Error();
      },
      removeItem: () => undefined,
    };
    expect(writeShareReturnMarker(token, unavailable)).toBe(false);
  });
});
