import { useEffect, useMemo } from 'react';
import { Navigate, Outlet, useLocation, useRoutes, type RouteObject } from 'react-router-dom';

import { AppShell } from '../components/AppShell';
import { CreateDrillPage } from '../features/custom-sets/CreateDrillPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { LibraryPage } from '../features/library/LibraryPage';
import { TrainingSetDetailPage } from '../features/library/TrainingSetDetailPage';
import { NotFoundPage } from '../features/not-found/NotFoundPage';
import { useTrainingStore } from '../lib/training-store-context';
import { getAllTrainingSets } from '../lib/training-data';

const routeTitles: Readonly<Record<string, string>> = {
  '/app/dashboard': 'Dashboard',
  '/app/library': 'Drill library',
  '/app/drills/new': 'Create drill',
};

function AppLayout() {
  const customTrainingSets = useTrainingStore((state) => state.customTrainingSets);
  const libraryCount = useMemo(
    () => getAllTrainingSets(customTrainingSets).length,
    [customTrainingSets],
  );

  return <AppShell libraryCount={libraryCount} />;
}

function RouteFocusAndTitle() {
  const location = useLocation();

  useEffect(() => {
    const title =
      routeTitles[location.pathname] ??
      (location.pathname.startsWith('/app/library/') ? 'Drill details' : 'KendoMenu');
    document.title = `${title} · KendoMenu`;
    document.getElementById('main-content')?.focus();
  }, [location.pathname]);

  return null;
}

function RouteRoot() {
  return (
    <>
      <RouteFocusAndTitle />
      <Outlet />
    </>
  );
}

function StandaloneNotFoundPage() {
  return (
    <main id="main-content" className="main-content" tabIndex={-1}>
      <NotFoundPage />
    </main>
  );
}

export const appRoutes: RouteObject[] = [
  {
    element: <RouteRoot />,
    children: [
      { path: '/', element: <Navigate replace to="/app/dashboard" /> },
      {
        path: '/app',
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate replace to="/app/dashboard" /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'library', element: <LibraryPage /> },
          { path: 'library/:trainingSetId', element: <TrainingSetDetailPage /> },
          { path: 'drills/new', element: <CreateDrillPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      { path: '*', element: <StandaloneNotFoundPage /> },
    ],
  },
];

export function App() {
  return useRoutes(appRoutes);
}
