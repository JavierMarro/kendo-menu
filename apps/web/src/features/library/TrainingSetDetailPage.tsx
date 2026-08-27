import { Navigate, useLocation, useParams } from 'react-router-dom';

import { getLibraryDrillLocation, LIBRARY_PATH } from './library-query';

export function TrainingSetDetailPage() {
  const { trainingSetId } = useParams();
  const location = useLocation();

  if (trainingSetId === undefined) {
    return <Navigate replace to={LIBRARY_PATH} />;
  }

  return (
    <Navigate
      replace
      to={{
        ...getLibraryDrillLocation(location.search, trainingSetId),
        hash: location.hash,
      }}
    />
  );
}
