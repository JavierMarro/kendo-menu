import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createTrainingStore, type StateStorage, type TrainingStoreApi } from '@kendo-menu/store';
import type { ReactNode } from 'react';

import { App } from '../app/App';
import {
  PersistenceContext,
  type PersistenceContextValue,
} from '../features/persistence/PersistenceGate';
import { TrainingStoreProvider } from '../lib/training-store-context';

export const TEST_STORAGE_KEY = 'kendo-menu-test';

export class TestMemoryStorage implements StateStorage {
  readonly #values = new Map<string, string>();

  constructor(initialValues: Readonly<Record<string, string>> = {}) {
    for (const [name, value] of Object.entries(initialValues)) {
      this.#values.set(name, value);
    }
  }

  getItem(name: string): string | null {
    return this.#values.get(name) ?? null;
  }

  setItem(name: string, value: string): void {
    this.#values.set(name, value);
  }

  removeItem(name: string): void {
    this.#values.delete(name);
  }

  read(name: string = TEST_STORAGE_KEY): string | null {
    return this.getItem(name);
  }
}

export function createTestStore(
  storage: StateStorage = new TestMemoryStorage(),
  storageKey: string = TEST_STORAGE_KEY,
): TrainingStoreApi {
  return createTrainingStore({ storage, storageKey });
}

interface AppRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  readonly initialEntries?: readonly string[];
  readonly persistence?: Partial<PersistenceContextValue>;
}

export function renderApp(store: TrainingStoreApi, options: AppRenderOptions = {}): RenderResult {
  const { initialEntries = ['/app/dashboard'], persistence = {}, ...renderOptions } = options;
  const persistenceValue: PersistenceContextValue = {
    mode: persistence.mode ?? 'local',
    writeFailed: persistence.writeFailed ?? false,
  };

  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <PersistenceContext.Provider value={persistenceValue}>
        <TrainingStoreProvider store={store}>
          <MemoryRouter initialEntries={[...initialEntries]}>{children}</MemoryRouter>
        </TrainingStoreProvider>
      </PersistenceContext.Provider>
    );
  }

  return render(<App />, { wrapper: Wrapper, ...renderOptions });
}
