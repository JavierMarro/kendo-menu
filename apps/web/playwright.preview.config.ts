import { defineConfig } from '@playwright/test';

import developmentConfig from './playwright.config';

const previewPort = 4175;
const previewUrl = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  ...developmentConfig,
  use: {
    ...developmentConfig.use,
    baseURL: previewUrl,
  },
  webServer: {
    command: `pnpm typecheck && pnpm exec vite build --config vite.preview.config.ts --configLoader runner && pnpm preview --host 127.0.0.1 --port ${previewPort}`,
    url: previewUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
