import { createContext, useContext } from 'react';

export interface InstallExperienceContextValue {
  readonly isInstallActionAvailable: boolean;
  readonly registerInstallAction: (element: HTMLButtonElement | null) => void;
  readonly openInstallExperience: (trigger: HTMLElement) => void;
}

const defaultContextValue: InstallExperienceContextValue = {
  isInstallActionAvailable: false,
  registerInstallAction: (_element) => undefined,
  openInstallExperience: (_trigger) => undefined,
};

export const InstallExperienceContext =
  createContext<InstallExperienceContextValue>(defaultContextValue);

export function useInstallExperience(): InstallExperienceContextValue {
  return useContext(InstallExperienceContext);
}
