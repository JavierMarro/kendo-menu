import type { Dispatch, SetStateAction } from 'react';

export interface PwaRegisterTestState {
  readonly needRefresh: [boolean, Dispatch<SetStateAction<boolean>>];
  readonly offlineReady: [boolean, Dispatch<SetStateAction<boolean>>];
  readonly updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}

export function useRegisterSW(): PwaRegisterTestState {
  const setBoolean: Dispatch<SetStateAction<boolean>> = () => undefined;
  return {
    needRefresh: [false, setBoolean],
    offlineReady: [false, setBoolean],
    updateServiceWorker: async () => undefined,
  };
}
