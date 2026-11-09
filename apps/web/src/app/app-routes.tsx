/**
 * Declares the public, guest, and account route trees; guest and account routes reuse pages under
 * different workspace owners. Legacy app paths enter guest routes, while shared document behavior
 * remains with RouteRoot above the tree.
 */
import type { RouteObject } from 'react-router-dom';

import { RouteErrorRethrow } from '../features/errors/RouteErrorRethrow';
import { CreateDrillPage, EditDrillPage } from '../features/custom-sets/CreateDrillPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { LandingPage } from '../features/landing/LandingPage';
import { LibraryPage } from '../features/library/LibraryPage';
import { TrainingSetDetailPage } from '../features/library/TrainingSetDetailPage';
import { NotFoundPage } from '../features/not-found/NotFoundPage';
import { AccountSetupPage } from '../features/account/AccountSetupPage';
import { SignInPage } from '../features/account/SignInPage';
import { CookiePolicyPage } from '../features/privacy/CookiePolicyPage';
import { PrivacyPolicyPage } from '../features/privacy/PrivacyPolicyPage';
import { GlossaryPage } from '../features/glossary/GlossaryPage';
import { SourcesPage } from '../features/sources/SourcesPage';
import { MitoriRoomPage } from '../features/mitori/MitoriRoomPage';
import { SharedMenuPage } from '../features/sharing/SharedMenuPage';
import {
  AccountWorkspaceRoute,
  AccountWorkspaceIndex,
} from '../features/account/AccountWorkspaceProvider';
import { GuestWorkspaceRoute } from '../features/persistence/GuestWorkspaceRoute';
import {
  AppLayout,
  RouteRoot,
  StandaloneNotFoundPage,
  LandingRedirect,
  LegacyWorkspaceRedirect,
  WorkspaceIndex,
} from './app-route-components';

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
          { path: 'sign-in', element: <SignInPage /> },
          { path: 'shared/:token', element: <SharedMenuPage /> },
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
              { path: 'mitori-room', element: <MitoriRoomPage /> },
              { path: 'drills/new', element: <CreateDrillPage /> },
              { path: 'drills/:entryId/edit', element: <EditDrillPage /> },
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
              { path: 'shared/:token', element: <SharedMenuPage recipient /> },
              { path: 'library', element: <LibraryPage /> },
              { path: 'library/:trainingSetId', element: <TrainingSetDetailPage /> },
              { path: 'mitori-room', element: <MitoriRoomPage /> },
              { path: 'drills/new', element: <CreateDrillPage /> },
              { path: 'drills/:entryId/edit', element: <EditDrillPage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
          { path: 'sources', element: <SourcesPage /> },
          { path: 'glossary', element: <GlossaryPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      {
        path: '/privacy',
        element: <AppLayout />,
        children: [{ index: true, element: <PrivacyPolicyPage /> }],
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
