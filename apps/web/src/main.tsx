import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { appRoutes } from './app/app-routes';
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
        <RouterProvider router={router} />
      </DataRouterModeProvider>
    </ApplicationRecovery>
  </StrictMode>,
);
