import { readFileSync } from 'node:fs';

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import journal from '../../drizzle/meta/_journal.json' with { type: 'json' };
import { persistenceSchema } from './schema.js';

describe('Drizzle source/snapshot alignment', () => {
  it('matches the latest snapshot column metadata to the current table definitions', () => {
    const latest = journal.entries.at(-1);
    if (!latest) throw new Error('Migration journal is empty');

    const snapshot: unknown = JSON.parse(
      readFileSync(
        new URL(
          `../../drizzle/meta/${String(latest.idx).padStart(4, '0')}_snapshot.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const tables = Object.fromEntries(
      Object.values(persistenceSchema).map((table) => {
        const config = getTableConfig(table);
        return [
          `${config.schema ?? 'public'}.${config.name}`,
          {
            columns: Object.fromEntries(
              config.columns.map((column) => [
                column.name,
                {
                  name: column.name,
                  type: column.getSQLType(),
                  primaryKey: column.primary,
                  notNull: column.notNull,
                },
              ]),
            ),
          },
        ];
      }),
    );

    // Metadata-chain checks do not compare these SQL types with the source schema.
    expect(snapshot).toMatchObject({ tables });
  });
});
