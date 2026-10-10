import { createContext, useContext } from 'react';

import type { AccountApiClient, ManagedAccountRecord } from './account-api';
import type { ManagedAuthClient } from './managed-auth';

export type ManagedIdentityState =
  | { readonly status: 'checking' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'uninitialized' }
  | { readonly status: 'verified'; readonly account: ManagedAccountRecord };

export interface ManagedAuthContextValue {
  readonly client: ManagedAuthClient | undefined;
  readonly api: AccountApiClient;
  readonly identity: ManagedIdentityState;
  readonly verifyIdentity: () => Promise<ManagedIdentityState>;
  readonly setVerifiedAccount: (account: ManagedAccountRecord) => void;
  readonly invalidateIdentity: () => void;
  readonly startGoogleSignIn: () => Promise<boolean>;
  readonly signOutProvider: () => Promise<boolean>;
}

export const ManagedAuthContext = createContext<ManagedAuthContextValue | null>(null);

export function useManagedAuth(): ManagedAuthContextValue {
  const value = useContext(ManagedAuthContext);
  if (value === null) throw new Error('useManagedAuth must be inside ManagedAuthProvider.');
  return value;
}
