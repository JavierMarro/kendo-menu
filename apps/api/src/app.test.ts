import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import type { Account } from './account/account.js';
import type { Dashboard } from './dashboard/dashboard.js';
import type { Adoption } from './adoption/adoption.js';

const unavailable: Account = {
  handle: () => Promise.resolve(Response.json({ error: 'AUTH_UNAVAILABLE' }, { status: 503 })),
};
const dashboard: Dashboard = {
  handle: () => Promise.resolve(Response.json({ error: 'AUTH_UNAVAILABLE' }, { status: 503 })),
};
const adoption: Adoption = {
  handle: () => Promise.resolve(Response.json({ error: 'AUTH_UNAVAILABLE' }, { status: 503 })),
};

describe('listener-free API route composition', () => {
  it('keeps health available and reports missing routes as no-store JSON', async () => {
    const app = createApp({ account: unavailable, dashboard, adoption });
    const health = await app.handle(new Request('http://localhost/api/health'));
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: 'ok' });
    expect(health.headers.get('cache-control')).toBe('private, no-store');
    const retired = await app.handle(new Request('http://localhost/api/session'));
    expect(retired.status).toBe(404);
    expect(retired.headers.get('cache-control')).toBe('private, no-store');
    expect(await retired.json()).toEqual({ error: 'NOT_FOUND' });
  });

  it('dispatches bodyless account initialization and leaves dashboard body parsing to the handler', async () => {
    const accountHandler = vi.fn(() => Promise.resolve(Response.json({ created: false })));
    const dashboardHandler = vi.fn(() => Promise.resolve(Response.json({ revision: '0' })));
    const app = createApp({
      account: { handle: accountHandler },
      dashboard: { handle: dashboardHandler },
      adoption,
    });
    const accountResponse = await app.handle(
      new Request('http://localhost/api/account', { method: 'POST' }),
    );
    expect(accountResponse.status).toBe(200);
    expect(accountHandler).toHaveBeenCalledTimes(1);
    const dashboardResponse = await app.handle(
      new Request('http://localhost/api/dashboard', { method: 'PUT', body: '{}' }),
    );
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardHandler).toHaveBeenCalledTimes(1);
  });
});
