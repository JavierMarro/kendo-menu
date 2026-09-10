import { spawn } from 'node:child_process';
import { validateTestDatabaseUrl } from './test-database.js';

try {
  validateTestDatabaseUrl(process.env['TEST_DATABASE_URL']);
  const child = spawn(
    process.execPath,
    ['../../node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts'],
    { stdio: 'inherit' },
  );
  child.on('error', () => {
    process.stderr.write('POSTGRESQL_TEST_RUNNER_FAILED\n');
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} catch {
  process.stderr.write('TEST_DATABASE_URL_REQUIRED_LOCAL_KENDOMENU_TEST\n');
  process.exitCode = 1;
}
