import { createApp } from '@kendo-menu/api';

const app = createApp();

export default {
  fetch(request: Request) {
    return app.handle(request);
  },
};
