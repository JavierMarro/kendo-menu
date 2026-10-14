/**
 * Shares install actions between the landing page and shared site chrome without exposing browser
 * prompt state to page components. The landing-entry hook records once per mount, and the default
 * context safely disables installation when no provider is present.
 */
import { createContext, useContext, useEffect, useRef } from 'react';

export interface InstallExperienceContextValue {
  readonly isInstallActionAvailable: boolean;
  readonly recordLandingEntry: () => void;
  readonly registerInstallAction: (element: HTMLButtonElement | null) => void;
  readonly openInstallExperience: (trigger: HTMLElement) => void;
}

const defaultContextValue: InstallExperienceContextValue = {
  isInstallActionAvailable: false,
  recordLandingEntry: () => undefined,
  registerInstallAction: (_element) => undefined,
  openInstallExperience: (_trigger) => undefined,
};

export const InstallExperienceContext =
  createContext<InstallExperienceContextValue>(defaultContextValue);

export function useInstallExperience(): InstallExperienceContextValue {
  return useContext(InstallExperienceContext);
}

export function useInstallLandingEntry(): void {
  const { recordLandingEntry } = useInstallExperience();
  const hasRecordedEntry = useRef(false);

  useEffect(() => {
    if (hasRecordedEntry.current) {
      return;
    }

    hasRecordedEntry.current = true;
    recordLandingEntry();
  }, [recordLandingEntry]);
}
