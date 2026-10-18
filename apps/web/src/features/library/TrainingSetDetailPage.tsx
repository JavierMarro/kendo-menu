/**
 * Preserves legacy session-detail URLs by translating them into the library's query-backed dialog
 * route. Workspace ownership, query parameters, and the URL hash are carried through the redirect.
 */
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
