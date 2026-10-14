/**
 * Starts the browser SPA after the auth dispatcher has resolved callback-only documents.
 * Recovery and shared providers surround the router so route-owned guest and account boundaries
 * can supply their own stores without sharing ownership.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { appRoutes } from './app/app-routes';
import { ManagedAuthProvider } from './features/account/ManagedAuthProvider';
import { ApplicationRecovery } from './features/errors/ApplicationRecovery';
import { DataRouterModeProvider } from './lib/router-context';
import './styles.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('The application root element is missing.');
}

const router = createBrowserRouter(appRoutes);

createRoot(rootElement).render(
  <StrictMode>
    <ApplicationRecovery>
      <DataRouterModeProvider>
        <ManagedAuthProvider>
          <RouterProvider router={router} />
        </ManagedAuthProvider>
      </DataRouterModeProvider>
    </ApplicationRecovery>
  </StrictMode>,
);
