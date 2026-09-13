/**
 * Listener-free Elysia route table shared by the Vercel and standalone Node adapters.
 * Runtime services are composed lazily by default, while tests can inject service boundaries;
 * every API response is private and dashboard PUT parsing remains owned by its bounded handler.
 */
import { Elysia } from 'elysia';
import { WebStandardAdapter } from 'elysia/adapter/web-standard';

import type { Authentication } from './auth/contracts.js';
import type { Dashboard } from './dashboard/dashboard.js';
import { createRuntimeServices } from './runtime.js';

const CACHE_CONTROL = 'private, no-store';

function methodNotAllowed(allow: string): Response {
  return new Response(null, {
    status: 405,
    headers: {
      allow,
      'cache-control': CACHE_CONTROL,
    },
  });
}

/** Optional service overrides for isolated Request/Response and listener tests. */
export interface AppOptions {
  readonly authentication?: Authentication;
  readonly dashboard?: Dashboard;
}

export const createApp = (options: AppOptions = {}) => {
  const { authentication, dashboard } =
    options.authentication !== undefined && options.dashboard !== undefined
      ? { authentication: options.authentication, dashboard: options.dashboard }
      : { ...createRuntimeServices(), ...options };
  // This route table is the single ordering point shared by both runtime adapters.
  // Dashboard PUT opts out of framework parsing so its bounded handler sees the raw body.
  return new Elysia({ adapter: WebStandardAdapter })
    .onRequest(({ request, set }) => {
      set.headers['cache-control'] = CACHE_CONTROL;
      if (new URL(request.url).pathname === '/api/auth/google/callback') {
        set.headers['referrer-policy'] = 'no-referrer';
      }
    })
    .onError({ as: 'global' }, ({ code, set }) => {
      set.headers['cache-control'] = CACHE_CONTROL;
      set.status = code === 'NOT_FOUND' ? 404 : 500;

      return {
        error: code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
      };
    })
    .get('/api/health', () => ({ status: 'ok' }))
    .head(
      '/api/health',
      () =>
        new Response(null, {
          headers: {
            'cache-control': CACHE_CONTROL,
            'content-type': 'application/json',
          },
        }),
    )
    .get('/api/auth/google/start', ({ request }) => authentication.start(request))
    .head('/api/auth/google/start', () => methodNotAllowed('GET'))
    .get('/api/auth/google/callback', ({ request }) => authentication.callback(request))
    .head('/api/auth/google/callback', () => methodNotAllowed('GET'))
    .get('/api/session', ({ request }) => authentication.getSession(request))
    .head('/api/session', () => methodNotAllowed('GET, DELETE'))
    .delete('/api/session', ({ request }) => authentication.logout(request))
    .get('/api/dashboard', ({ request }) => dashboard.handle(request))
    .put('/api/dashboard', ({ request }) => dashboard.handle(request), { parse: 'none' })
    .head('/api/dashboard', ({ request }) => dashboard.handle(request))
    .all('/api/dashboard', ({ request }) => dashboard.handle(request), { parse: 'none' });
};

export type App = ReturnType<typeof createApp>;
