/**
 * Integration-test entry point. It validates the local test-database target
 * before Vitest can open a socket, and converts setup failures into fixed output
 * that cannot disclose a connection string.
 */
import { spawn } from 'node:child_process';
import { validateTestDatabaseUrl } from './test-database.js';

try {
  validateTestDatabaseUrl(process.env['TEST_DATABASE_URL']);
  // The child receives a fixed executable and argument list; the connection URL
  // is inherited only as environment data and is never interpolated into a shell
  // command. Inherited stdio keeps normal Vitest diagnostics visible.
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
    // Preserve Vitest's failure code for CI. A missing exit code is treated as a
    // failure rather than accidentally acknowledging an interrupted test run.
    process.exitCode = code ?? 1;
  });
} catch {
  process.stderr.write('TEST_DATABASE_URL_REQUIRED_LOCAL_KENDOMENU_TEST\n');
  process.exitCode = 1;
}
