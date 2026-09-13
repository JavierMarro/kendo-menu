import { createApp, createRuntimeServices } from '@kendo-menu/api';
import { attachDatabasePool } from '@vercel/functions';

const app = createApp(createRuntimeServices({ onPoolCreated: attachDatabasePool }));

export default {
  fetch(request: Request) {
    return app.handle(request);
  },
};
