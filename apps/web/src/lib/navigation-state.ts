export interface SavedMenuNavigationState {
  readonly type: 'saved-menu';
  readonly menuName: string;
}

export function createSavedMenuNavigationState(menuName: string): SavedMenuNavigationState {
  return {
    type: 'saved-menu',
    menuName,
  };
}

export function getSavedMenuNavigationState(value: unknown): SavedMenuNavigationState | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  if (!('type' in value) || value.type !== 'saved-menu') {
    return null;
  }

  if (!('menuName' in value) || typeof value.menuName !== 'string') {
    return null;
  }

  return {
    type: value.type,
    menuName: value.menuName,
  };
}
