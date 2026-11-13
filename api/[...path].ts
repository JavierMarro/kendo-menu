/**
 * Thin Vercel fetch adapter for the listener-free API application.
 * One service graph is created per function instance so authentication and dashboards share the
 * same lazy PostgreSQL pool, which is attached immediately to Vercel's lifecycle hook.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp, createRuntimeServices } from '@kendo-menu/api';
import { attachDatabasePool } from '@vercel/functions';

const app = createApp(createRuntimeServices({ onPoolCreated: attachDatabasePool }));

async function sharedMenuDocument(method: string): Promise<Response> {
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
  };
  try {
    const html = await readFile(join(process.cwd(), 'apps/web/dist/shared-menu.html'), 'utf8');
    return new Response(method === 'HEAD' ? null : html, { headers });
  } catch {
    return new Response(method === 'HEAD' ? null : 'Shared menu unavailable', {
      status: 503,
      headers,
    });
  }
}

export default {
  fetch(request: Request) {
    const url = new URL(request.url);
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      /^\/(?:share|app\/shared)\/[A-Za-z0-9_-]{43}\/?$/u.test(url.pathname)
    ) {
      return sharedMenuDocument(request.method);
    }
    return app.handle(request);
  },
};
