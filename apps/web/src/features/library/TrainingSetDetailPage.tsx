import { Navigate, useLocation, useParams } from 'react-router-dom';

import { getLibraryDrillLocation } from './library-query';
import { useWorkspace, workspacePath } from '../../lib/workspace-context';

export function TrainingSetDetailPage() {
  const { trainingSetId } = useParams();
  const location = useLocation();
  const workspace = useWorkspace();
  const libraryPath = workspacePath(workspace.basePath, 'library');

  if (trainingSetId === undefined) {
    return <Navigate replace to={libraryPath} />;
  }

  return (
    <Navigate
      replace
      to={{
        ...getLibraryDrillLocation(location.search, trainingSetId, libraryPath),
        hash: location.hash,
      }}
    />
  );
}
