import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { appRoutes } from './app/App';
import { PersistenceGate } from './features/persistence/PersistenceGate';
import { DataRouterModeProvider } from './lib/router-context';
import './styles.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('The application root element is missing.');
}

const router = createBrowserRouter(appRoutes);

createRoot(rootElement).render(
  <StrictMode>
    <PersistenceGate>
      <DataRouterModeProvider>
        <RouterProvider router={router} />
      </DataRouterModeProvider>
    </PersistenceGate>
  </StrictMode>,
);
