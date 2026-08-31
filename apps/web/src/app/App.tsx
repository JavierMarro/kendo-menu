import { useRoutes } from 'react-router-dom';

import { appRoutes } from './app-routes';

export function App() {
  return useRoutes(appRoutes);
}
