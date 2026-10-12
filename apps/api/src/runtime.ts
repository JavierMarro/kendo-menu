/**
 * Composes managed identity verification, account authorization, and protected API handlers.
 * Persistence is lazy until an account-mapping or data request needs PostgreSQL; concurrent
 * initialization is shared by its provider.
 * The managed verifier and exact application Origin check form the identity boundary for mutations.
 */
import { createAccountAuthorization } from './auth/account-authorization.js';
import {
  createManagedIdentityVerifier,
  type ManagedIdentityVerifier,
} from './auth/managed-identity.js';
import { createAccount } from './account/account.js';
import { createAdoption } from './adoption/adoption.js';
import { createDashboard } from './dashboard/dashboard.js';
import { createDashboardCatalogue } from './dashboard/validation.js';
import { createRuntimePersistence, type RuntimePersistenceOptions } from './persistence/runtime.js';

/** Bind managed verification configuration and compose lazy services without opening sockets. */
export function createRuntimeServices(
  options: RuntimePersistenceOptions = {},
  managedIdentity: ManagedIdentityVerifier = createManagedIdentityVerifier(
    process.env['NEON_AUTH_BASE_URL'],
  ),
) {
  const persistence = createRuntimePersistence(options);
  const catalogue = createDashboardCatalogue();
  const appOrigin = (): string => {
    const value = process.env['APP_ORIGIN'];
    if (value === undefined) throw new Error('APP_ORIGIN_UNAVAILABLE');
    const origin = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (
      origin.origin !== value ||
      origin.username !== '' ||
      origin.password !== '' ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))
    )
      throw new Error('APP_ORIGIN_INVALID');
    return origin.origin;
  };
  const authorization = createAccountAuthorization({
    verify: managedIdentity,
    lookup: {
      findManagedAccount: async (identity) =>
        (await persistence.get()).managedAccounts.findManagedAccount(identity),
    },
    getAppOrigin: appOrigin,
  });
  const dashboard = createDashboard({
    authorization,
    persistence: async () => (await persistence.get()).dashboards,
    catalogue,
  });
  const adoption = createAdoption({
    authorization,
    persistence: async () => (await persistence.get()).managedCopy,
    catalogue,
  });
  const account = createAccount({
    authorization,
    persistence: async () => (await persistence.get()).managedAccounts,
  });
  return { account, authorization, dashboard, adoption };
}
