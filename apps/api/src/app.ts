import { Elysia } from 'elysia';
import { WebStandardAdapter } from 'elysia/adapter/web-standard';

import type { Authentication } from './auth/contracts.js';
import { createRuntimeAuthentication } from './runtime.js';

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

/**
 * Build the HTTP application without binding a port or reading runtime state.
 * Runtime adapters compose this application with their own transport wiring.
 */
export interface AppOptions {
  readonly authentication?: Authentication;
}

export const createApp = (options: AppOptions = {}) => {
  const authentication = options.authentication ?? createRuntimeAuthentication();
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
    .delete('/api/session', ({ request }) => authentication.logout(request));
};

export type App = ReturnType<typeof createApp>;
