/**
 * Declares the public, guest, and account route trees; guest and account routes reuse pages under
 * different workspace owners. Legacy app paths enter guest routes, while shared document behavior
 * remains with RouteRoot above the tree.
 */
import { Navigate, useLocation, type RouteObject } from 'react-router-dom';

import { RouteErrorRethrow } from '../features/errors/RouteErrorRethrow';
import { CreateDrillPage } from '../features/custom-sets/CreateDrillPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { LandingPage } from '../features/landing/LandingPage';
import { LibraryPage } from '../features/library/LibraryPage';
import { TrainingSetDetailPage } from '../features/library/TrainingSetDetailPage';
import { NotFoundPage } from '../features/not-found/NotFoundPage';
import { AccountSetupPage } from '../features/account/AccountSetupPage';
import { CookiePolicyPage } from '../features/privacy/CookiePolicyPage';
import { GlossaryPage } from '../features/glossary/GlossaryPage';
import { SourcesPage } from '../features/sources/SourcesPage';
import {
  AccountWorkspaceRoute,
  AccountWorkspaceIndex,
} from '../features/account/AccountWorkspaceProvider';
import { GuestWorkspaceRoute } from '../features/persistence/GuestWorkspaceRoute';
import { AppLayout, RouteRoot, StandaloneNotFoundPage } from './app-route-components';

function LandingRedirect() {
  const location = useLocation();
  return <Navigate replace to={{ pathname: '/app', search: location.search }} />;
}

function LegacyWorkspaceRedirect({
  page,
}: {
  readonly page: 'dashboard' | 'library' | 'drills/new' | 'library/:trainingSetId';
}) {
  const location = useLocation();
  const pathname =
    page === 'library/:trainingSetId'
      ? `/app/guest/library${location.pathname.slice('/app/library'.length)}`
      : `/app/guest/${page}`;
  return <Navigate replace to={{ pathname, search: location.search, hash: location.hash }} />;
}

function WorkspaceIndex() {
  return <Navigate replace to="dashboard" />;
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
          { path: 'dashboard', element: <LegacyWorkspaceRedirect page="dashboard" /> },
          { path: 'library', element: <LegacyWorkspaceRedirect page="library" /> },
          {
            path: 'library/:trainingSetId',
            element: <LegacyWorkspaceRedirect page="library/:trainingSetId" />,
          },
          { path: 'drills/new', element: <LegacyWorkspaceRedirect page="drills/new" /> },
          {
            path: 'guest',
            element: <GuestWorkspaceRoute />,
            children: [
              { index: true, element: <WorkspaceIndex /> },
              { path: 'dashboard', element: <DashboardPage /> },
              { path: 'library', element: <LibraryPage /> },
              { path: 'library/:trainingSetId', element: <TrainingSetDetailPage /> },
              { path: 'drills/new', element: <CreateDrillPage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
          {
            path: 'account',
            element: <AccountWorkspaceRoute />,
            children: [
              { index: true, element: <AccountWorkspaceIndex /> },
              { path: 'setup', element: <AccountSetupPage /> },
              { path: 'dashboard', element: <DashboardPage /> },
              { path: 'library', element: <LibraryPage /> },
              { path: 'library/:trainingSetId', element: <TrainingSetDetailPage /> },
              { path: 'drills/new', element: <CreateDrillPage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
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
