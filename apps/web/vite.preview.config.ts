import { fileURLToPath } from 'node:url';

import { defineConfig, mergeConfig } from 'vite';

import productionConfig from './vite.config';

export default defineConfig(
  mergeConfig(productionConfig, {
    build: {
      rollupOptions: {
        input: {
          app: fileURLToPath(new URL('./index.html', import.meta.url)),
          errorFixture: fileURLToPath(new URL('./e2e/error-fixture.html', import.meta.url)),
          recursiveFixture: fileURLToPath(new URL('./e2e/recursive-fixture.html', import.meta.url)),
          accountFixture: fileURLToPath(new URL('./e2e/account-fixture.html', import.meta.url)),
          accountDatabaseFixture: fileURLToPath(
            new URL('./e2e/account-database-fixture.html', import.meta.url),
          ),
          accountSyncFixture: fileURLToPath(
            new URL('./e2e/account-sync-fixture.html', import.meta.url),
          ),
        },
      },
    },
  }),
);
