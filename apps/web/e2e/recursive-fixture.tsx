import { createRoot } from 'react-dom/client';

import { createTrainingStore, type StateStorage } from '@kendo-menu/store';

import '../src/styles.css';
import { RECURSIVE_TRAINING_SET } from '../src/test/recursive-activity.fixture';
import { RecursiveFixtureApp } from './recursive-fixture-app';

const STORAGE_KEY = 'kendo-menu-recursive-e2e';

const browserStorage: StateStorage = {
  getItem: (name) => window.localStorage.getItem(name),
  setItem: (name, value) => window.localStorage.setItem(name, value),
  removeItem: (name) => window.localStorage.removeItem(name),
};

const store = createTrainingStore({ storage: browserStorage, storageKey: STORAGE_KEY });

if (
  !store
    .getState()
    .dashboardEntries.some((entry) => entry.trainingSetId === RECURSIVE_TRAINING_SET.id)
) {
  store.getState().addToDashboard(RECURSIVE_TRAINING_SET.id);
}

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('The recursive fixture root is missing.');
}

const view =
  new URLSearchParams(window.location.search).get('view') === 'dashboard' ? 'dashboard' : 'library';
createRoot(rootElement).render(<RecursiveFixtureApp store={store} view={view} />);
