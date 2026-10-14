/**
 * Listener-free Elysia route table shared by the Vercel and standalone Node adapters.
 * Runtime services are lazy by default; tests can inject boundaries, and common response handling
 * keeps results private.
 * Bounded writes leave parsing to their handlers so authorization and size checks retain order.
 */
import { Elysia } from 'elysia';
import { WebStandardAdapter } from 'elysia/adapter/web-standard';

import type { Account } from './account/account.js';
import type { Adoption } from './adoption/adoption.js';
import type { Dashboard } from './dashboard/dashboard.js';
import type { ManagedIdentityVerifier } from './auth/managed-identity.js';
import { createRuntimeServices } from './runtime.js';

const CACHE_CONTROL = 'private, no-store';

/** Optional service overrides for isolated Request/Response and listener tests. */
export interface AppOptions {
  readonly account?: Account;
  readonly dashboard?: Dashboard;
  readonly adoption?: Adoption;
  /** Isolated development proof only; ordinary composition does not inject it. */
  readonly managedIdentity?: ManagedIdentityVerifier;
}

export const createApp = (options: AppOptions = {}) => {
  const runtime =
    options.account === undefined ||
    options.dashboard === undefined ||
    options.adoption === undefined
      ? createRuntimeServices()
      : undefined;
  const account = options.account ?? runtime?.account;
  const dashboard = options.dashboard ?? runtime?.dashboard;
  const adoption = options.adoption ?? runtime?.adoption;
  if (account === undefined || dashboard === undefined || adoption === undefined) {
    throw new Error('RUNTIME_SERVICES_NOT_COMPOSED');
  }
  // This route table is the single ordering point shared by both runtime adapters.
  // Dashboard PUT and adoption POST opt out of framework parsing so their bounded
  // handlers see raw bodies and can authenticate before reading them.
  const app = new Elysia({ adapter: WebStandardAdapter })
    .onRequest(({ request: _request, set }) => {
      set.headers['cache-control'] = CACHE_CONTROL;
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
    .get('/api/account', ({ request }) => account.handle(request))
    .post('/api/account', ({ request }) => account.handle(request), { parse: 'none' })
    .head('/api/account', ({ request }) => account.handle(request), { parse: 'none' })
    .get('/api/dashboard', ({ request }) => dashboard.handle(request))
    .put('/api/dashboard', ({ request }) => dashboard.handle(request), { parse: 'none' })
    .head('/api/dashboard', ({ request }) => dashboard.handle(request))
    .post('/api/dashboard/adoption', ({ request }) => adoption.handle(request), { parse: 'none' })
    .head('/api/dashboard/adoption', ({ request }) => adoption.handle(request), { parse: 'none' })
    .all('/api/dashboard/adoption', ({ request }) => adoption.handle(request), { parse: 'none' })
    .all('/api/dashboard', ({ request }) => dashboard.handle(request), { parse: 'none' })
    .all('/api/account', ({ request }) => account.handle(request), { parse: 'none' });

  const managedIdentity = options.managedIdentity;
  if (managedIdentity === undefined) return app;
  return app.get('/api/dev/managed-identity', async ({ request }) => {
    const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/iu);
    if (match?.[1] === undefined) {
      return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
    }
    try {
      const result = await managedIdentity(match[1]);
      if (result.status === 'invalid') {
        return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
      }
      if (result.status === 'unavailable') {
        return Response.json({ error: 'MANAGED_AUTH_UNAVAILABLE' }, { status: 503 });
      }
      return Response.json({ identity: result.identity });
    } catch {
      return Response.json({ error: 'MANAGED_AUTH_UNAVAILABLE' }, { status: 503 });
    }
  });
};

export type App = ReturnType<typeof createApp>;
