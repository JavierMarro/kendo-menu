/**
 * Guards the command-only database tooling against accidental connections to a
 * development, remote, or ambiguously configured database.
 *
 * These tests run without opening a socket. Their purpose is to prove that an
 * unsafe URL or migration option is rejected before PostgreSQL can be touched.
 */
import { describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrate.js';
import { validateTestDatabaseUrl } from './test-database.js';

describe('test database guard', () => {
  it('requires a local, explicitly designated test database before connecting', () => {
    const rejected = [
      undefined,
      '',
      'invalid',
      'postgresql://localhost/kendomenu_dev',
      'postgresql://example.com/kendomenu_test',
      'postgresql://localhost/kendomenu_test?host=example.com',
      'postgresql://localhost/kendomenu_test?options=-csearch_path=public',
      'postgresql://localhost/kendomenu_test#fragment',
      'https://localhost/kendomenu_test',
      'postgresql://localhost/kendomenu%5ftest',
    ];
    for (const value of rejected) {
      expect(() => validateTestDatabaseUrl(value)).toThrow('TEST_DATABASE_CONFIGURATION_INVALID');
    }
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const value = `postgresql://${host}/kendomenu_test`;
      expect(validateTestDatabaseUrl(value) === value).toBe(true);
    }
  });
});

describe('migration configuration', () => {
  it('rejects missing configuration and unsafe schema names without database access', async () => {
    await expect(migrateDatabase({ connectionString: '' })).rejects.toThrow(
      'MIGRATION_CONFIGURATION_INVALID',
    );
    await expect(
      migrateDatabase({ connectionString: 'unused', schema: 'public;drop schema public' }),
    ).rejects.toThrow('MIGRATION_CONFIGURATION_INVALID');
  });

  it('sanitizes malformed connection errors', async () => {
    let safeFailure = false;
    try {
      await migrateDatabase({ connectionString: 'postgresql://[invalid' });
    } catch (error) {
      safeFailure = error instanceof Error && error.message === 'MIGRATION_CONFIGURATION_INVALID';
    }
    expect(safeFailure).toBe(true);
  });
});
