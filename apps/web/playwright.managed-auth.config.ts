import { defineConfig } from '@playwright/test';
import developmentConfig from './playwright.config';

export default defineConfig({
  ...developmentConfig,
  testMatch: 'managed-auth-proof.spec.ts',
  testIgnore: '**/pwa.spec.ts',
  use: {
    ...developmentConfig.use,
    baseURL: 'http://127.0.0.1:4177',
    trace: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 4177 --strictPort',
    url: 'http://127.0.0.1:4177/managed-auth-proof.html',
    reuseExistingServer: false,
    env: { VITE_NEON_AUTH_URL: 'https://synthetic-auth.example.invalid/neon/auth' },
  },
});
