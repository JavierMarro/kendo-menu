import { describe, expect, it } from 'vitest';

import { filterGlossary, normalizeGlossaryText } from './glossary-search';

describe('glossary lookup', () => {
  it('matches menu spelling aliases without case, spacing or macron differences', () => {
    const entries = [{ id: 'do', term: 'Dō', definition: 'Torso target.', aliases: ['Dou'] }];
    expect(filterGlossary(entries, ' DŌ ')).toEqual(entries);
    expect(filterGlossary(entries, 'dou')).toEqual(entries);
    expect(filterGlossary(entries, 'men')).toEqual([]);
    expect(normalizeGlossaryText('Kote–men')).toBe(normalizeGlossaryText('kote men'));
  });

  it('preserves Japanese characters instead of treating them as an empty search', () => {
    const entries = [{ id: 'men', term: 'Men', definition: 'Head target.', aliases: ['面'] }];
    expect(filterGlossary(entries, '面')).toEqual(entries);
    expect(filterGlossary(entries, '小手')).toEqual([]);
  });
});
