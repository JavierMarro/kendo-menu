import { createContext } from 'react';

import type { AdoptionDecisionRequest, ManagedAccountInitialization } from '../../lib/account-api';

export interface AccountSetupContextValue {
  readonly accountId: string;
  readonly handoff: ManagedAccountInitialization | null;
  readonly revision: string;
  readonly catalogueVersion: string | null;
  readonly ready: boolean;
  readonly identityVerified: boolean;
  readonly dashboardStatus:
    'loading' | 'ready' | 'unavailable' | 'auth-hidden' | 'load-error' | 'disposed';
  readonly dashboardLoaded: boolean;
  readonly submit: (
    request: AdoptionDecisionRequest,
  ) => Promise<'accepted' | 'declined' | 'unconfirmed' | 'abandoned' | 'stale'>;
  readonly release: () => void;
  readonly reload: () => Promise<void>;
}

export const AccountSetupContext = createContext<AccountSetupContextValue | null>(null);
