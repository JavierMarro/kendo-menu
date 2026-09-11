import { createAuthentication } from './auth/authentication.js';
import { readAppOrigin, readGoogleConfiguration } from './auth/configuration.js';
import { createGoogleAuthenticationAdapter } from './auth/google.js';
import { createRuntimePersistence, type RuntimePersistenceOptions } from './persistence/runtime.js';

/** Compose server-only dependencies without reading configuration or opening sockets. */
export function createRuntimeAuthentication(options: RuntimePersistenceOptions = {}) {
  const persistence = createRuntimePersistence(options);
  return createAuthentication({
    persistence: persistence.get,
    getGoogleConfiguration: readGoogleConfiguration,
    getAppOrigin: readAppOrigin,
    google: createGoogleAuthenticationAdapter(),
  });
}
