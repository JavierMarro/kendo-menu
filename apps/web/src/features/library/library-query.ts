export const LIBRARY_PATH = '/app/library';
export const DRILL_QUERY_PARAMETER = 'drill';

export const LIBRARY_DRILL_NAVIGATION_STATE = {
  openedFromLibrary: true,
} as const;

export function isLibraryDrillNavigationState(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return (
    'openedFromLibrary' in value &&
    value.openedFromLibrary === LIBRARY_DRILL_NAVIGATION_STATE.openedFromLibrary
  );
}

export function getSelectedDrillId(search: string): string | undefined {
  const drillId = new URLSearchParams(search).get(DRILL_QUERY_PARAMETER)?.trim();
  return drillId === undefined || drillId.length === 0 ? undefined : drillId;
}

function updateDrillSearch(search: string, drillId?: string): string {
  const searchParameters = new URLSearchParams(search);

  if (drillId === undefined) {
    searchParameters.delete(DRILL_QUERY_PARAMETER);
  } else {
    searchParameters.set(DRILL_QUERY_PARAMETER, drillId);
  }

  const nextSearch = searchParameters.toString();
  return nextSearch.length === 0 ? '' : `?${nextSearch}`;
}

export function getLibraryDrillLocation(search: string, drillId: string) {
  return {
    pathname: LIBRARY_PATH,
    search: updateDrillSearch(search, drillId),
  };
}

export function getLibraryLocationWithoutDrill(search: string) {
  return {
    pathname: LIBRARY_PATH,
    search: updateDrillSearch(search),
  };
}
