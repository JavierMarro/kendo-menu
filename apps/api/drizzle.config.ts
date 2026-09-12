/**
 * Drizzle Kit reads the reviewed TypeScript schema and writes one root migration
 * chain. Generation is a development task only: the HTTP application does not
 * import this configuration or mutate the database schema at request time.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/persistence/schema.ts',
  out: './drizzle',
});
