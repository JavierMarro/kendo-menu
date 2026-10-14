/**
 * Persistence port for consuming a managed account's one-use guest-copy opportunity.
 * Acceptance follows commit of the complete snapshot and terminal outcome. A later copy failure
 * does not reopen the consumed opportunity.
 */
import type { AccountAuthorizationProof } from '../auth/account-authorization.js';
import type { DashboardWriteAcknowledgement } from '../dashboard/contracts.js';
import type { ValidatedAdoptionRequest } from '../adoption/contracts.js';
import type { ValidatedDashboardWrite } from '../dashboard/validation.js';

export type ManagedCopyOutcome =
  | { readonly status: 'accepted'; readonly acknowledgement: DashboardWriteAcknowledgement }
  | { readonly status: 'declined' }
  | { readonly status: 'capability-unavailable' }
  | { readonly status: 'revision-conflict' }
  | { readonly status: 'catalogue-incompatible' }
  | { readonly status: 'account-not-initialized' }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'unavailable' };

export interface ManagedCopyPersistence {
  consumeOpportunity(
    proof: AccountAuthorizationProof,
    intent: ValidatedAdoptionRequest,
    isCatalogueCompatible: (intent: ValidatedDashboardWrite) => boolean,
  ): Promise<ManagedCopyOutcome>;
}
