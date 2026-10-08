import { describe, expect, it } from 'vitest';

import { rankOptions, type Rankable } from './combobox-rank.js';

const opts = (...names: string[]): Rankable[] =>
  names.map((name, i) => ({ code: `04034060${String(i).padStart(2, '0')}`, name }));

const names = (rows: Rankable[]) => rows.map((r) => r.name);

describe('rankOptions', () => {
  it('returns every option untouched when nothing has been typed', () => {
    const all = opts('Calauan', 'Calamba', 'Los Banos');

    expect(names(rankOptions(all, ''))).toEqual(['Calauan', 'Calamba', 'Los Banos']);
  });

  it('ignores a whitespace-only query, because that is still browsing', () => {
    const all = opts('Calauan', 'Los Banos');

    expect(names(rankOptions(all, '   '))).toEqual(['Calauan', 'Los Banos']);
  });

  it('ranks an exact match first', () => {
    const all = opts('Calauan', 'Calaunan', 'San Calauan');

    expect(names(rankOptions(all, 'Calaunan'))[0]).toBe('Calaunan');
  });

  it('ranks starts-with above a mid-word contains', () => {
    // Both contain "cal"; the one that STARTS with it must come first.
    const all = opts('Macalinos', 'Calauan');

    expect(names(rankOptions(all, 'cal'))).toEqual(['Calauan', 'Macalinos']);
  });

  it('ranks a word-start above a mid-word contains', () => {
    // "Poblacion" starts the word; "Barangay Poblacion Norte" only contains it.
    const all = opts('Barangay Poblacion Norte', 'Poblacion');

    expect(names(rankOptions(all, 'poblacion'))).toEqual([
      'Poblacion',
      'Barangay Poblacion Norte',
    ]);
  });

  it('matches case-insensitively', () => {
    const all = opts('CALAUAN', 'Los Banos');

    expect(names(rankOptions(all, 'calauan'))[0]).toBe('CALAUAN');
  });

  it('collapses spacing differences before matching', () => {
    const all = opts('San  Felipe', 'San Felipe');

    expect(names(rankOptions(all, 'san felipe'))[0]).toBe('San  Felipe');
  });

  it('folds diacritics for matching but leaves the official name untouched', () => {
    const all = opts('Biñan', 'Bacoor');

    expect(names(rankOptions(all, 'binyan'))[0]).toBe('Biñan');
  });

  it('still matches a name whose diacritics are mangled by the provider', () => {
    // The upstream service serves some names with a broken encoding. Search must
    // not become the thing that breaks because of it.
    const all = opts('City of BiÃ±an', 'Bacoor');

    expect(names(rankOptions(all, 'binyan'))[0]).toBe('City of BiÃ±an');
  });

  it('offers a near-spelling when the exact spelling is absent', () => {
    const all = opts('Calauan', 'Calamba', 'Los Banos');

    expect(names(rankOptions(all, 'Calan'))).toContain('Calauan');
  });

  it('excludes options with no textual relationship at all', () => {
    const all = opts('Calauan', 'Los Banos');

    expect(names(rankOptions(all, 'cal'))).toEqual(['Calauan']);
  });

  it('never lets a loose fuzzy tier outrank a literal match', () => {
    const all = opts('Calan', 'Calauan');

    expect(names(rankOptions(all, 'calauan'))[0]).toBe('Calauan');
  });

  it('is deterministic: the same input always yields the same order', () => {
    const all = opts('Calauan', 'Calamba', 'Calayan', 'Calasiao');

    expect(names(rankOptions(all, 'cal'))).toEqual(names(rankOptions(all, 'cal')));
  });

  it('keeps the provider order within one tier instead of reshuffling', () => {
    const all = opts('Calauan', 'Calamba', 'Calayan');

    expect(names(rankOptions(all, 'cal'))).toEqual(['Calauan', 'Calamba', 'Calayan']);
  });

  it('does not mutate the caller list', () => {
    const all = opts('Calauan', 'Macalinos');

    rankOptions(all, 'cal');

    expect(names(all)).toEqual(['Calauan', 'Macalinos']);
  });

  it('ranks a longer query no more loosely than a shorter one', () => {
    // A long query that only matches loosely must not drag a weak candidate in
    // front of nothing; the point is that precision beats recall.
    const all = opts('Calauan', 'Los Banos');

    expect(names(rankOptions(all, 'calauanlaguna'))).toEqual([]);
  });
});