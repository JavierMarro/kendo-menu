import type { SessionAuthorizationProof } from '../auth/session-authorization.js';
import type {
  DashboardReadResponse,
  DashboardWriteAcknowledgement,
  Revision,
} from '../dashboard/contracts.js';
import type { ValidatedDashboardWrite } from '../dashboard/validation.js';

export type DashboardPersistenceFailure =
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'auth-unavailable' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'workspace-mismatch' };

export type DashboardReadOutcome =
  | { readonly status: 'read'; readonly response: DashboardReadResponse }
  | DashboardPersistenceFailure;

export type DashboardWriteOutcome =
  | {
      readonly status: 'written' | 'replayed';
      readonly acknowledgement: DashboardWriteAcknowledgement;
    }
  | { readonly status: 'revision-conflict'; readonly currentRevision: Revision }
  | { readonly status: 'request-id-reused' }
  | { readonly status: 'catalogue-incompatible' }
  | DashboardPersistenceFailure;

/**
 * Protected application seam, intentionally unimplemented in Job 5A.
 *
 * Every operation must revalidate the server-established proof against the active session.
 * The proof's user is authoritative; the request workspace is only a mismatch guard.
 * Reads, failures and retained retries must not touch activity, cookies or receipts.
 *
 * compareAndWrite must serialize account writes, look up retained request IDs before any
 * revision comparison/cleanup, and invoke isCatalogueCompatible only for new IDs. A retained
 * identical digest returns its ORIGINAL acknowledgement even after catalogue/revision changes;
 * different digests conflict. No caller may treat this interface or fake tests as SQL evidence.
 *
 * New writes use bigint arithmetic, increment even for identical/empty content, and atomically
 * commit dashboard + receipt + cleanup + final session touch. Only successful new writes remove
 * receipts aged >= seven days and then evict oldest revisions to the 1,024/account cap. Expiry,
 * revocation, revision exhaustion and ambiguous commits fail closed; never retry writes here.
 * The SQL implementation and its locking/failure-injection evidence belong exclusively to Job 5B.
 */
export interface DashboardPersistence {
  read(proof: SessionAuthorizationProof): Promise<DashboardReadOutcome>;
  compareAndWrite(
    proof: SessionAuthorizationProof,
    intent: ValidatedDashboardWrite,
    isCatalogueCompatible: (intent: ValidatedDashboardWrite) => boolean,
  ): Promise<DashboardWriteOutcome>;
}

export type DashboardPersistenceProvider =
  DashboardPersistence | (() => DashboardPersistence | Promise<DashboardPersistence>);
