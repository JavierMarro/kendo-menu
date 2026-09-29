import { Navigate, useLocation, type RouteObject } from 'react-router-dom';

import { RouteErrorRethrow } from '../features/errors/RouteErrorRethrow';
import { CreateDrillPage } from '../features/custom-sets/CreateDrillPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { LandingPage } from '../features/landing/LandingPage';
import { LibraryPage } from '../features/library/LibraryPage';
import { TrainingSetDetailPage } from '../features/library/TrainingSetDetailPage';
import { NotFoundPage } from '../features/not-found/NotFoundPage';
import { CookiePolicyPage } from '../features/privacy/CookiePolicyPage';
import { GlossaryPage } from '../features/glossary/GlossaryPage';
import { SourcesPage } from '../features/sources/SourcesPage';
import { AppLayout, RouteRoot, StandaloneNotFoundPage } from './app-route-components';

function LandingRedirect() {
  const location = useLocation();
  return <Navigate replace to={{ pathname: '/app', search: location.search }} />;
}

export const appRoutes: RouteObject[] = [
  {
    element: <RouteRoot />,
    errorElement: <RouteErrorRethrow />,
    children: [
      { path: '/', element: <LandingRedirect /> },
      {
        path: '/app',
        element: <AppLayout />,
        children: [
          { index: true, element: <LandingPage /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'library', element: <LibraryPage /> },
          { path: 'library/:trainingSetId', element: <TrainingSetDetailPage /> },
          { path: 'drills/new', element: <CreateDrillPage /> },
          { path: 'sources', element: <SourcesPage /> },
          { path: 'glossary', element: <GlossaryPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      {
        path: '/cookies',
        element: <AppLayout />,
        children: [{ index: true, element: <CookiePolicyPage /> }],
      },
      { path: '*', element: <StandaloneNotFoundPage /> },
    ],
  },
];
