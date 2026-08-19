import { useMemo, useState } from 'react';

import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';

import { AppShell, type AppView } from '../components/AppShell';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { LibraryPage } from '../features/library/LibraryPage';
import { useTrainingStore } from '../lib/training-store';

export function App() {
  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const customTrainingSets = useTrainingStore((state) => state.customTrainingSets);
  const libraryCount = useMemo(
    () => DEFAULT_TRAINING_SETS.length + customTrainingSets.length,
    [customTrainingSets.length],
  );

  return (
    <AppShell activeView={activeView} libraryCount={libraryCount} onViewChange={setActiveView}>
      {activeView === 'dashboard' ? <DashboardPage /> : <LibraryPage />}
    </AppShell>
  );
}
