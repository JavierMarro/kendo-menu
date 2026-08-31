import { defineConfig, devices } from '@playwright/test';

const previewPort = 4174;
const previewUrl = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] === undefined ? 0 : 2,
  reporter: 'list',
  use: {
    baseURL: previewUrl,
    launchOptions: {
      args: [
        '--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND,MAP javiermarro.goatcounter.com ~NOTFOUND',
      ],
    },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${previewPort}`,
    url: previewUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
