import { Elysia } from 'elysia';
import { WebStandardAdapter } from 'elysia/adapter/web-standard';

const CACHE_CONTROL = 'private, no-store';

/**
 * Build the HTTP application without binding a port or reading runtime state.
 * Runtime adapters compose this application with their own transport wiring.
 */
export const createApp = () =>
  new Elysia({ adapter: WebStandardAdapter })
    .onRequest(({ set }) => {
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
    );

export type App = ReturnType<typeof createApp>;
