import { describe, expect, it } from 'vitest';

import {
  cmsLinkedCategorySlugs,
  cmsLinkedListingIds,
  resolveCategoryLink,
  resolveListingLink,
} from './catalogLinks';

const listings = [{ id: 'lake-view-villa' }, { id: 'city-loft' }];
const categories = [{ slug: 'villas' }, { slug: 'lofts' }];

describe('resolveListingLink', () => {
  it('explicit link wins over a same-id auto candidate', () => {
    expect(resolveListingLink({ id: 'lake-view-villa', catalogId: 'city-loft' }, listings)).toEqual(
      { kind: 'explicit', target: { id: 'city-loft' } },
    );
  });

  it('auto-matches on id equality without an explicit link', () => {
    expect(resolveListingLink({ id: 'lake-view-villa' }, listings)).toEqual({
      kind: 'auto',
      target: { id: 'lake-view-villa' },
    });
  });

  it('reports dangling explicit links and plain unlinked entries', () => {
    expect(resolveListingLink({ id: 'x', catalogId: 'gone' }, listings)).toEqual({
      kind: 'dangling',
      missing: 'gone',
    });
    expect(resolveListingLink({ id: 'x' }, listings)).toEqual({ kind: 'none' });
    expect(resolveListingLink({ id: 'x' }, undefined)).toEqual({ kind: 'none' });
  });
});

describe('resolveCategoryLink', () => {
  it('explicit link wins, auto-matches on slug equality, flags dangling', () => {
    expect(resolveCategoryLink({ slug: 'villas', catalogSlug: 'lofts' }, categories)).toEqual({
      kind: 'explicit',
      target: { slug: 'lofts' },
    });
    expect(resolveCategoryLink({ slug: 'villas' }, categories)).toEqual({
      kind: 'auto',
      target: { slug: 'villas' },
    });
    expect(resolveCategoryLink({ slug: 'villas', catalogSlug: 'gone' }, categories)).toEqual({
      kind: 'dangling',
      missing: 'gone',
    });
    expect(resolveCategoryLink({ slug: 'villas' }, [])).toEqual({ kind: 'none' });
  });
});

describe('effective link sets', () => {
  it('collects explicit and auto-matched ids, skipping dangling and unlinked', () => {
    expect(
      cmsLinkedListingIds(
        [
          { id: 'lake-view-villa', catalogId: 'city-loft' },
          { id: 'city-loft' },
          { id: 'x', catalogId: 'gone' },
          { id: 'y' },
        ],
        listings,
      ),
    ).toEqual(new Set(['city-loft']));
    expect(
      cmsLinkedCategorySlugs([{ slug: 'villas' }, { slug: 'x', catalogSlug: 'gone' }], categories),
    ).toEqual(new Set(['villas']));
  });
});
