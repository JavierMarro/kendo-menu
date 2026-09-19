/**
 * Production service composition for Google authentication and protected dashboards.
 * Both services close over one lazy persistence provider, preserving one pool and one account
 * model without opening sockets or reading configuration during module import.
 */
import { createAuthentication } from './auth/authentication.js';
import { readAppOrigin, readGoogleConfiguration } from './auth/configuration.js';
import { createGoogleAuthenticationAdapter } from './auth/google.js';
import { createSessionAuthorization } from './auth/session-authorization.js';
import { createAdoption } from './adoption/adoption.js';
import { createDashboard } from './dashboard/dashboard.js';
import { createDashboardCatalogue } from './dashboard/validation.js';
import { createRuntimePersistence, type RuntimePersistenceOptions } from './persistence/runtime.js';

/** Compose server-only dependencies without reading configuration or opening sockets. */
export function createRuntimeServices(options: RuntimePersistenceOptions = {}) {
  const persistence = createRuntimePersistence(options);
  const catalogue = createDashboardCatalogue();
  const authorization = createSessionAuthorization({
    persistence: persistence.get,
    getAppOrigin: readAppOrigin,
  });
  const authentication = createAuthentication({
    persistence: persistence.get,
    getGoogleConfiguration: readGoogleConfiguration,
    getAppOrigin: readAppOrigin,
    google: createGoogleAuthenticationAdapter(),
  });
  const dashboard = createDashboard({
    authorization,
    persistence: async () => (await persistence.get()).dashboards,
    catalogue,
  });
  const adoption = createAdoption({
    authorization,
    persistence: persistence.get,
    catalogue,
  });
  return { authentication, dashboard, adoption };
}

export function createRuntimeAuthentication(options: RuntimePersistenceOptions = {}) {
  // Retained for callers that need only the authentication service; construction
  // is still side-effect free because persistence remains lazy.
  return createRuntimeServices(options).authentication;
}
