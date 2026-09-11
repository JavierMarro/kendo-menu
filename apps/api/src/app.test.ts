import { Server } from 'node:net';
import { Elysia } from 'elysia';
import { WebStandardAdapter } from 'elysia/adapter/web-standard';
import { Client, Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import vercelHandler from '../../../api/[...path].js';
import { createApp } from './app.js';
import { createNodeApp } from './node-app.js';

afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllEnvs());

const composedApp = new Elysia({ adapter: WebStandardAdapter }).use(createApp());

const handlers = {
  composed: (request: Request) => composedApp.handle(request),
  application: (request: Request) => createApp().handle(request),
  node: (request: Request) => createNodeApp().handle(request),
  vercel: (request: Request) => vercelHandler.fetch(request),
};

for (const [name, handle] of Object.entries(handlers)) {
  describe(name, () => {
    it('preserves both stale-cookie clearing headers through the transport', async () => {
      vi.stubEnv('DATABASE_URL', 'postgresql://127.0.0.1:1/kendomenu_dev');
      const connect = vi.spyOn(Pool.prototype, 'connect');
      const response = await handle(
        new Request('https://app.example.test/api/session', {
          headers: {
            cookie: '__Host-kendomenu-session=malformed; __Host-kendomenu-session=malformed',
          },
        }),
      );
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([
        expect.stringMatching(/^__Host-kendomenu-session=;.*Max-Age=0;.*HttpOnly$/u),
        expect.stringMatching(/^__Host-kendomenu-csrf=;.*Max-Age=0;.*Secure$/u),
      ]);
      expect(connect).not.toHaveBeenCalled();
    });
    it.each([
      ['/api/auth/google/start', 'GET'],
      ['/api/auth/google/callback', 'GET'],
      ['/api/session', 'GET'],
      ['/api/session', 'DELETE'],
    ])('fails safely without operation configuration: %s %s', async (path, method) => {
      for (const variable of [
        'DATABASE_URL',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REDIRECT_URI',
        'APP_ORIGIN',
      ]) {
        vi.stubEnv(variable, undefined);
      }
      const response = await handle(new Request(`https://app.example.test${path}`, { method }));
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      await expect(response.json()).resolves.toEqual({ error: 'AUTH_UNAVAILABLE' });
      if (path.endsWith('/callback')) {
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
        expect(response.headers.getSetCookie()).toEqual([
          expect.stringContaining('__Host-kendomenu-login='),
        ]);
      } else {
        expect(response.headers.getSetCookie()).toEqual([]);
      }
      expect((await handle(new Request('https://app.example.test/api/health'))).status).toBe(200);
    });
    it.each(['/api/health', '/api/health?probe=1'])(
      'returns fixed health JSON for %s',
      async (path) => {
        const response = await handle(new Request(`http://localhost${path}`));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toMatch(/^application\/json/);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        await expect(response.json()).resolves.toEqual({ status: 'ok' });
      },
    );

    it('supports HEAD without a body', async () => {
      const response = await handle(new Request('http://localhost/api/health', { method: 'HEAD' }));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      await expect(response.text()).resolves.toBe('');
    });

    it.each([
      ['/api/auth/google/start', 'GET'],
      ['/api/auth/google/callback?state=ignored&code=ignored', 'GET'],
      ['/api/session', 'GET, DELETE'],
    ])('rejects auth HEAD without touching credentials: %s', async (path, allow) => {
      const response = await handle(
        new Request(`https://app.example.test${path}`, {
          method: 'HEAD',
          headers: {
            cookie:
              '__Host-kendomenu-login=malformed; __Host-kendomenu-session=malformed; __Host-kendomenu-csrf=malformed',
          },
        }),
      );
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe(allow);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.getSetCookie()).toEqual([]);
      await expect(response.text()).resolves.toBe('');
    });

    it.each([
      ['/api', 'GET'],
      ['/api/', 'GET'],
      ['/api/unknown/nested?probe=1', 'GET'],
      ['/api/health', 'POST'],
      ['/api/health', 'PUT'],
      ['/api/health', 'DELETE'],
      ['/api/health', 'OPTIONS'],
    ])('returns a non-cache JSON 404 for %s %s', async (path, method) => {
      const response = await handle(new Request(`http://localhost${path}`, { method }));
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toMatch(/^application\/json/);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      await expect(response.json()).resolves.toEqual({ error: 'NOT_FOUND' });
    });
  });
}

it('imports and handles requests without starting a listener or making external requests', async () => {
  vi.resetModules();
  const listen = vi.spyOn(Server.prototype, 'listen').mockImplementation(() => {
    throw new Error('Unexpected listener');
  });
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
  const { createApp: freshApp } = await import('./app.js');
  const { default: freshAdapter } = await import('../../../api/[...path].js');
  expect((await freshApp().handle(new Request('http://localhost/api/health'))).status).toBe(200);
  expect((await freshAdapter.fetch(new Request('http://localhost/api/missing'))).status).toBe(404);
  expect(listen).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps health and adapter imports independent of database configuration and connections', async () => {
  vi.resetModules();
  for (const variable of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'TEST_DATABASE_URL']) {
    vi.stubEnv(variable, undefined);
  }
  const poolConnect = vi.spyOn(Pool.prototype, 'connect').mockImplementation(() => {
    throw new Error('UNEXPECTED_DATABASE_CONNECTION');
  });
  const clientConnect = vi.spyOn(Client.prototype, 'connect').mockImplementation(() => {
    throw new Error('UNEXPECTED_DATABASE_CONNECTION');
  });
  const { createApp: freshApp } = await import('./app.js');
  const { default: freshAdapter } = await import('../../../api/[...path].js');
  expect((await freshApp().handle(new Request('http://localhost/api/health'))).status).toBe(200);
  expect((await freshAdapter.fetch(new Request('http://localhost/api/health'))).status).toBe(200);
  expect(poolConnect).not.toHaveBeenCalled();
  expect(clientConnect).not.toHaveBeenCalled();
});
