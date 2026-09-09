import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const pwaRegisterTestStub = fileURLToPath(
  new URL('./src/test/pwa-register-react.ts', import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'virtual:pwa-register/react': pwaRegisterTestStub,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['./src/**/*.test.{ts,tsx}'],
    maxWorkers: 2,
    restoreMocks: true,
    clearMocks: true,
  },
});
