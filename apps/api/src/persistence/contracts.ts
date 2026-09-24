/**
 * Application-facing persistence contracts for the authentication foundation.
 *
 * The PostgreSQL adapter is deliberately hidden behind this interface. Callers
 * deal in authentication intent and safe outcomes, rather than tables, SQL,
 * checked-out clients, or driver errors.
 */

import type { DashboardWriteAcknowledgement, Revision } from '../dashboard/contracts.js';
import type { ValidatedDashboardWrite } from '../dashboard/validation.js';

export type UserId = string;
export type SessionId = string;
export type Sha256Hash = string;

export type PersistenceErrorCode = 'INVALID_INPUT' | 'CONFLICT' | 'UNAVAILABLE' | 'FAILED';

const PERSISTENCE_ERROR_MESSAGES: Record<PersistenceErrorCode, string> = {
  INVALID_INPUT: 'Persistence input is invalid',
  CONFLICT: 'Persistence conflict',
  UNAVAILABLE: 'Persistence storage is unavailable',
  FAILED: 'Persistence operation failed',
};

/** A stable, non-sensitive error surface for persistence failures. */
export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode) {
    super(PERSISTENCE_ERROR_MESSAGES[code]);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

export type PersistenceClock = () => Date;

export interface UserRecord {
  readonly id: UserId;
  /** Immutable external identity. Email is mutable display metadata, never identity. */
  readonly googleSub: string;
  readonly verifiedGoogleEmail: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PublicUserRecord {
  readonly id: UserId;
  readonly verifiedGoogleEmail: string | null;
}

export interface ResolveGoogleUserInput {
  readonly googleSub: string;
  /** Undefined/null means missing or unverified; only a verified value replaces metadata. */
  readonly verifiedGoogleEmail?: string | null;
}

export interface LoginTransactionCreationInput {
  readonly stateHash: Sha256Hash;
  readonly browserBindingHash: Sha256Hash;
  readonly nonceHash: Sha256Hash;
  /** The raw PKCE verifier is callback material and is cleared on consumption. */
  readonly pkceCodeVerifier: string;
  readonly returnPath?: string;
  readonly expiresAt: Date;
  readonly createdAt?: Date;
}

export interface LoginTransactionReceipt {
  readonly id: string;
  readonly returnPath: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface ConsumeLoginTransactionInput {
  readonly stateHash: Sha256Hash;
  readonly browserBindingHash: Sha256Hash;
  readonly at?: Date;
}

export interface ConsumedLoginTransaction {
  /** The verifier is returned once to the callback exchange, then gone from storage. */
  readonly pkceCodeVerifier: string;
  /** The callback hashes the returned OIDC nonce and compares it with this value. */
  readonly nonceHash: Sha256Hash;
  readonly returnPath: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export type ConsumeLoginTransactionResult =
  // Explicit outcomes let authentication return one generic public failure while
  // tests and cleanup retain enough meaning to verify replay and expiry policy.
  | { readonly outcome: 'success'; readonly transaction: ConsumedLoginTransaction }
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'expired' }
  | { readonly outcome: 'consumed' }
  | { readonly outcome: 'binding-mismatch' };

export interface LoginTransactionCleanupInput {
  readonly at?: Date;
  readonly limit?: number;
}

export interface LoginTransactionCleanupResult {
  readonly deleted: number;
}

export interface SessionRecord {
  // Raw and hashed browser credentials are intentionally absent. Callers can
  // authorize by session identity without being able to re-export stored hashes.
  readonly id: SessionId;
  readonly userId: UserId;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface SessionCreationInput {
  readonly userId: UserId;
  readonly sessionTokenHash: Sha256Hash;
  readonly csrfTokenHash: Sha256Hash;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly createdAt?: Date;
  readonly lastActivityAt?: Date;
}

export interface SessionLookupInput {
  readonly sessionTokenHash: Sha256Hash;
  /** Include this for a state-changing operation that also requires CSRF validation. */
  readonly csrfTokenHash?: Sha256Hash;
  readonly at?: Date;
}

export interface SessionActivityInput {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly at?: Date;
  /** The later session module computes this value under the seven-day policy. */
  readonly idleExpiresAt: Date;
}

export interface SessionRevocationInput {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly at?: Date;
}

export interface SessionReplacementInput {
  readonly predecessorSessionId: SessionId;
  readonly userId: UserId;
  readonly replacement: SessionCreationInput;
  readonly at?: Date;
}

/** Inputs for the one transaction that finishes a verified Google callback. */
export interface CompleteGoogleLoginInput {
  readonly googleSub: string;
  /** Undefined/null means missing or unverified provider metadata. */
  readonly verifiedGoogleEmail?: string | null;
  readonly sessionTokenHash: Sha256Hash;
  readonly csrfTokenHash: Sha256Hash;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly createdAt?: Date;
  readonly lastActivityAt?: Date;
  readonly at?: Date;
  /** The current browser's session, if one was supplied to the callback. */
  readonly predecessorSessionTokenHash?: Sha256Hash;
}

export type CompleteGoogleLoginResult =
  | {
      readonly status: 'completed';
      readonly user: UserRecord;
      readonly session: SessionRecord;
    }
  | { readonly status: 'account-switch' };

export type AdoptionDecision = 'yes' | 'no';

export type AdoptionStatus =
  | { readonly status: 'pending' | 'unavailable'; readonly capability: boolean }
  | {
      readonly status: 'accepted';
      readonly capability: false;
      readonly completion: {
        readonly decision: 'yes';
        readonly requestId: string;
        readonly acknowledgedRevision: Revision;
        readonly timestamp: Date;
      };
    }
  | {
      readonly status: 'declined';
      readonly capability: false;
      readonly completion: { readonly decision: 'no'; readonly requestId: string };
    };

export interface AdoptionStatusInput {
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly sessionTokenHash: Sha256Hash;
}

export type AdoptionDecisionInput =
  | {
      readonly decision: 'yes';
      readonly expectedAccountWorkspaceId: UserId;
      /** Session-bound CSRF proof revalidated inside the adoption transaction. */
      readonly csrfTokenHash: Sha256Hash;
      readonly intent: ValidatedDashboardWrite;
    }
  | {
      readonly decision: 'no';
      readonly expectedAccountWorkspaceId: UserId;
      /** Session-bound CSRF proof revalidated inside the adoption transaction. */
      readonly csrfTokenHash: Sha256Hash;
      readonly requestId: string;
      /** Digest of the complete canonical No envelope, including metadata. */
      readonly requestDigest: Sha256Hash;
    };

export type AdoptionDecisionOutcome =
  | {
      readonly status: 'accepted' | 'replayed';
      readonly acknowledgement: DashboardWriteAcknowledgement;
      readonly completion: {
        readonly decision: 'yes';
        readonly requestId: string;
        readonly acknowledgedRevision: Revision;
        readonly timestamp: Date;
      };
    }
  | {
      readonly status: 'declined';
      readonly completion: { readonly decision: 'no'; readonly requestId: string };
    }
  | {
      readonly status: 'replayed-declined';
      readonly completion: { readonly decision: 'no'; readonly requestId: string };
    }
  | { readonly status: 'ineligible' }
  | { readonly status: 'capability-unavailable' }
  | { readonly status: 'revision-conflict'; readonly currentRevision: Revision }
  | { readonly status: 'request-id-reused' }
  | { readonly status: 'decision-conflict' }
  | { readonly status: 'catalogue-incompatible' }
  | { readonly status: 'workspace-mismatch' }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'auth-unavailable' }
  | { readonly status: 'unavailable' };

export interface KendoPersistence {
  readonly accounts: {
    /** Resolve identity, create the first session/capability, and rotate credentials atomically. */
    completeGoogleLogin(input: CompleteGoogleLoginInput): Promise<CompleteGoogleLoginResult>;
  };
  readonly users: {
    findPublicById(userId: UserId): Promise<PublicUserRecord | null>;
    resolveByGoogleSubject(input: ResolveGoogleUserInput): Promise<UserRecord>;
  };
  readonly loginTransactions: {
    create(input: LoginTransactionCreationInput): Promise<LoginTransactionReceipt>;
    consume(input: ConsumeLoginTransactionInput): Promise<ConsumeLoginTransactionResult>;
    /** Delete only a bounded batch so request-triggered maintenance has fixed work. */
    cleanupExpired(input?: LoginTransactionCleanupInput): Promise<LoginTransactionCleanupResult>;
  };
  readonly sessions: {
    create(input: SessionCreationInput): Promise<SessionRecord>;
    /** Revoke the active predecessor and insert its fresh replacement atomically. */
    replace(input: SessionReplacementInput): Promise<SessionRecord>;
    /** Return only sessions that are present, unrevoked, and inside both deadlines. */
    findActiveByTokenHash(input: SessionLookupInput): Promise<SessionRecord | null>;
    touch(input: SessionActivityInput): Promise<SessionRecord | null>;
    revoke(input: SessionRevocationInput): Promise<boolean>;
  };
  readonly adoptions: {
    /** Read-only status; this method never normalizes or touches session activity. */
    getStatus(input: AdoptionStatusInput): Promise<AdoptionStatus>;
    decide(
      input: AdoptionDecisionInput & AdoptionStatusInput,
      isCatalogueCompatible?: (intent: ValidatedDashboardWrite) => boolean,
    ): Promise<AdoptionDecisionOutcome>;
  };
}
