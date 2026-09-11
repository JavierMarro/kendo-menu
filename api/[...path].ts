import { createApp, createRuntimeAuthentication } from '@kendo-menu/api';
import { attachDatabasePool } from '@vercel/functions';

const app = createApp({
  authentication: createRuntimeAuthentication({ onPoolCreated: attachDatabasePool }),
});

export default {
  fetch(request: Request) {
    return app.handle(request);
  },
};
