/** Persistence boundary for private share creation and public or account-bound link reads. */
import type { AccountAuthorizationProof } from '../auth/account-authorization.js';
import type { Revision } from '../dashboard/contracts.js';
import type { SharedMenuV1 } from '@kendo-menu/domain/menu-sharing';

export type ShareCreateOutcome =
  | { readonly status: 'created'; readonly token: string; readonly sourceRevision: Revision }
  | { readonly status: 'revision-conflict'; readonly currentRevision: Revision }
  | { readonly status: 'not-shareable' }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'unavailable' };

export type ShareReadOutcome =
  | { readonly status: 'found'; readonly snapshot: SharedMenuV1 }
  | { readonly status: 'not-found' }
  | { readonly status: 'unavailable' };

export type RecipientShareReadOutcome =
  | {
      readonly status: 'found';
      readonly snapshot: SharedMenuV1;
      readonly isSender: boolean;
    }
  | { readonly status: 'not-found' }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'unavailable' };

export interface ManagedSharesPersistence {
  create(
    proof: AccountAuthorizationProof,
    expectedRevision: Revision,
    entryId: string,
  ): Promise<ShareCreateOutcome>;
  read(token: string): Promise<ShareReadOutcome>;
  readForRecipient(
    proof: AccountAuthorizationProof,
    token: string,
  ): Promise<RecipientShareReadOutcome>;
}
