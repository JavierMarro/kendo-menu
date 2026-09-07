import { useRouteError } from 'react-router-dom';

/** Let the router-independent application boundary handle unexpected route failures. */
export function RouteErrorRethrow(): never {
  throw useRouteError();
}
