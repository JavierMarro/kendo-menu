import { describe, expect, it } from 'vitest';

import { getSavedMenuNavigationState } from './navigation-state';

describe('saved menu navigation state', () => {
  it('rejects malformed values', () => {
    expect(getSavedMenuNavigationState(null)).toBeNull();
    expect(getSavedMenuNavigationState('saved-menu')).toBeNull();
    expect(getSavedMenuNavigationState(42)).toBeNull();
    expect(getSavedMenuNavigationState({ type: 'other', menuName: 'Practice' })).toBeNull();
    expect(getSavedMenuNavigationState({ type: 'saved-menu', menuName: 42 })).toBeNull();
  });
});
