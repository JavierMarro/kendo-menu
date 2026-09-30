/**
 * Thin Vercel fetch adapter for the listener-free API application.
 * One service graph is created per function instance so authentication and dashboards share the
 * same lazy PostgreSQL pool, which is attached immediately to Vercel's lifecycle hook.
 */
import { createApp, createRuntimeServices } from '@kendo-menu/api';
import { attachDatabasePool } from '@vercel/functions';

const app = createApp(createRuntimeServices({ onPoolCreated: attachDatabasePool }));

export default {
  fetch(request: Request) {
    return app.handle(request);
  },
};
