import { fileURLToPath } from 'node:url';

import { defineConfig, mergeConfig } from 'vite';

import productionConfig from './vite.config';

export default defineConfig(
  mergeConfig(productionConfig, {
    build: {
      rolldownOptions: {
        input: {
          errorFixture: fileURLToPath(new URL('./e2e/error-fixture.html', import.meta.url)),
          recursiveFixture: fileURLToPath(new URL('./e2e/recursive-fixture.html', import.meta.url)),
        },
      },
    },
  }),
);
