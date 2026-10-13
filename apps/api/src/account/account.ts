/**
 * HTTP boundary for managed-account initialization and reads.
 * Initialization uses server-verified Neon identity; reads require a proof bound to that identity.
 * After authorization, initialization checks actual body bytes because Node may wrap empty POSTs
 * in a stream.
 * Persistence maps the identity and creates any new-account copy opportunity with the account row.
 */
import {
  accountAuthorizationFailureResponse,
  type AccountAuthorization,
} from '../auth/account-authorization.js';
import type {
  AccountInitializationOutcome,
  ManagedAccountPersistence,
} from '../persistence/managed-account-contracts.js';

export interface Account {
  handle(request: Request): Promise<Response>;
}

async function hasEmptyBody(request: Request): Promise<boolean> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const body = request.body;
    if (body === null) return true;
    reader = body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return true;
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength !== 0) return false;
    }
  } catch {
    return false;
  } finally {
    // Canceling the Node request stream can close its socket before the fixed response is sent.
    reader?.releaseLock();
  }
}

export function createAccount(dependencies: {
  readonly authorization: AccountAuthorization;
  readonly persistence:
    | ManagedAccountPersistence
    | (() => ManagedAccountPersistence | Promise<ManagedAccountPersistence>);
}): Account {
  async function getPersistence(): Promise<ManagedAccountPersistence> {
    return typeof dependencies.persistence === 'function'
      ? dependencies.persistence()
      : dependencies.persistence;
  }

  return {
    async handle(request) {
      const method = request.method;
      if (method !== 'GET' && method !== 'POST') {
        return new Response(null, {
          status: 405,
          headers: { allow: 'GET, POST', 'cache-control': 'private, no-store' },
        });
      }
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return Response.json({ error: 'INVALID_ACCOUNT_REQUEST' }, { status: 400 });
      }
      if (url.search !== '') {
        return Response.json({ error: 'INVALID_ACCOUNT_REQUEST' }, { status: 400 });
      }

      if (method === 'POST') {
        // No account identifier is accepted; persistence maps only the verified provider subject.
        const verified = await dependencies.authorization.verifyIdentity(request);
        if (verified.status !== 'verified') {
          return accountAuthorizationFailureResponse(verified.status);
        }
        if (!(await hasEmptyBody(request))) {
          return Response.json({ error: 'INVALID_ACCOUNT_REQUEST' }, { status: 400 });
        }
        let outcome: AccountInitializationOutcome;
        try {
          outcome = await (await getPersistence()).initializeManagedAccount(verified.identity);
        } catch {
          return Response.json({ error: 'AUTH_UNAVAILABLE' }, { status: 503 });
        }
        if (outcome.status !== 'initialized') {
          const status =
            outcome.status === 'unauthenticated'
              ? 'unauthenticated'
              : outcome.status === 'account-not-initialized'
                ? 'not-initialized'
                : 'unavailable';
          return accountAuthorizationFailureResponse(status);
        }
        const body = {
          accountId: outcome.account.accountId,
          email: outcome.account.email,
          created: outcome.account.created,
          ...(outcome.account.copyOpportunityId === undefined
            ? {}
            : { copyOpportunityId: outcome.account.copyOpportunityId }),
        };
        return Response.json(body, { headers: { 'cache-control': 'private, no-store' } });
      }

      const authorized = await dependencies.authorization.authorizeRead(request);
      if (authorized.status !== 'authorized') {
        return accountAuthorizationFailureResponse(authorized.status);
      }
      try {
        const account = await (await getPersistence()).readAccount(authorized.proof);
        if ('status' in account) {
          const failure =
            account.status === 'unauthenticated'
              ? 'unauthenticated'
              : account.status === 'account-not-initialized'
                ? 'not-initialized'
                : 'unavailable';
          return accountAuthorizationFailureResponse(failure);
        }
        return Response.json(account, { headers: { 'cache-control': 'private, no-store' } });
      } catch {
        return Response.json({ error: 'AUTH_UNAVAILABLE' }, { status: 503 });
      }
    },
  };
}
