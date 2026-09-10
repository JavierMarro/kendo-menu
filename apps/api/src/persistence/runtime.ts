import { PersistenceError, type KendoPersistence } from './contracts.js';
import { createPostgresPersistence, type PostgresPersistence } from './postgres/adapter.js';

let cachedPersistence: PostgresPersistence | undefined;

/** Lazily create the warm-process pool for database-backed request paths. */
export function getRuntimePersistence(): KendoPersistence {
  if (cachedPersistence !== undefined) {
    return cachedPersistence;
  }

  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new PersistenceError('UNAVAILABLE');
  }

  cachedPersistence = createPostgresPersistence({ connectionString });
  return cachedPersistence;
}

/** Close the cached pool at an explicit process or test lifecycle boundary. */
export async function closeRuntimePersistence(): Promise<void> {
  const persistence = cachedPersistence;
  cachedPersistence = undefined;
  if (persistence !== undefined) {
    await persistence.close();
  }
}
