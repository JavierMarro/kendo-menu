/**
 * Hands route-loader and render failures to the router-independent application boundary.
 * This keeps recovery UI available even when React Router cannot render its own error route.
 */
import { useRouteError } from 'react-router-dom';

/** Let the router-independent application boundary handle unexpected route failures. */
export function RouteErrorRethrow(): never {
  throw useRouteError();
}
