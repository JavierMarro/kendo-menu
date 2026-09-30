import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

class DeterministicStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

const localStorage = new DeterministicStorage();
const guestOnlyFetch: typeof fetch = (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  return Promise.resolve(
    url === '/api/session'
      ? new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      : new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
  );
};

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorage,
});
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorage,
});
Object.defineProperty(globalThis, 'fetch', { configurable: true, value: guestOnlyFetch });

const scrollTo: Window['scrollTo'] = () => undefined;

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  value: scrollTo,
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});
