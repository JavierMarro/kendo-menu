import type { ManagedIdentity } from '../auth/managed-identity.js';
import type { AccountAuthorizationProof } from '../auth/account-authorization.js';

export interface ManagedAccountRecord {
  readonly accountId: string;
  readonly email: string | null;
}

export interface ManagedAccountInitialization extends ManagedAccountRecord {
  readonly created: boolean;
  readonly copyOpportunityId?: string;
}

export type AccountMutationFailure =
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'auth-unavailable' }
  | { readonly status: 'account-not-initialized' }
  | { readonly status: 'workspace-mismatch' }
  | { readonly status: 'unavailable' };

export type AccountInitializationOutcome =
  | { readonly status: 'initialized'; readonly account: ManagedAccountInitialization }
  | AccountMutationFailure;

export interface ManagedAccountPersistence {
  findManagedAccount(identity: ManagedIdentity): Promise<{ readonly accountId: string } | null>;
  initializeManagedAccount(identity: ManagedIdentity): Promise<AccountInitializationOutcome>;
  readAccount(
    proof: AccountAuthorizationProof,
  ): Promise<ManagedAccountRecord | AccountMutationFailure>;
}
