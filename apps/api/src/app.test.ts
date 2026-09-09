import { Server } from 'node:net';
import { Elysia } from 'elysia';
import { WebStandardAdapter } from 'elysia/adapter/web-standard';
import { afterEach, describe, expect, it, vi } from 'vitest';

import vercelHandler from '../../../api/[...path].js';
import { createApp } from './app.js';

afterEach(() => vi.restoreAllMocks());

const composedApp = new Elysia({ adapter: WebStandardAdapter }).use(createApp());

const handlers = {
  composed: (request: Request) => composedApp.handle(request),
  application: (request: Request) => createApp().handle(request),
  vercel: (request: Request) => vercelHandler.fetch(request),
};

for (const [name, handle] of Object.entries(handlers)) {
  describe(name, () => {
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
