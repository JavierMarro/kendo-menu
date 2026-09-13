import { createAuthentication } from './auth/authentication.js';
import { readAppOrigin, readGoogleConfiguration } from './auth/configuration.js';
import { createGoogleAuthenticationAdapter } from './auth/google.js';
import { createSessionAuthorization } from './auth/session-authorization.js';
import { createDashboard } from './dashboard/dashboard.js';
import { createRuntimePersistence, type RuntimePersistenceOptions } from './persistence/runtime.js';

/** Compose server-only dependencies without reading configuration or opening sockets. */
export function createRuntimeServices(options: RuntimePersistenceOptions = {}) {
  const persistence = createRuntimePersistence(options);
  const authentication = createAuthentication({
    persistence: persistence.get,
    getGoogleConfiguration: readGoogleConfiguration,
    getAppOrigin: readAppOrigin,
    google: createGoogleAuthenticationAdapter(),
  });
  const dashboard = createDashboard({
    authorization: createSessionAuthorization({
      persistence: persistence.get,
      getAppOrigin: readAppOrigin,
    }),
    persistence: async () => (await persistence.get()).dashboards,
  });
  return { authentication, dashboard };
}

export function createRuntimeAuthentication(options: RuntimePersistenceOptions = {}) {
  return createRuntimeServices(options).authentication;
}
