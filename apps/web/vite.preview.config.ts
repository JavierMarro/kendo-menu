import { fileURLToPath } from 'node:url';

import { defineConfig, mergeConfig } from 'vite';

import productionConfig from './vite.config';

export default defineConfig(
  mergeConfig(productionConfig, {
    build: {
      rollupOptions: {
        input: {
          app: fileURLToPath(new URL('./index.html', import.meta.url)),
          recursiveFixture: fileURLToPath(new URL('./e2e/recursive-fixture.html', import.meta.url)),
        },
      },
    },
  }),
);
