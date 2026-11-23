/**
 * Deterministic relevance ranking for a combobox.
 *
 * Tiers, best first: exact, starts-with, word-start, contains, then a bounded
 * fuzzy tier for the near-miss. "Nearest" here is NEAREST TEXTUAL MATCH - there
 * is no geographic distance anywhere in this file, and there never should be.
 *
 * Two rules that are easy to get wrong:
 *
 * - Matching normalises case, runs of whitespace, and diacritics. The DISPLAYED
 *   name is never rewritten. `Biñan` must stay `Biñan` in the list even though
 *   it is matched as `binyan`, because the provider's spelling is the official
 *   one and this function has no authority to change it. Encoding damage is
 *   repaired upstream, in the provider adapter, before a name ever arrives here.
 * - The order inside a tier is the provider's order. `sort` is stable, so equal
 *   scores never reshuffle between renders.
 */

export interface Rankable {
  code: string;
  name: string;
}

/** Higher is better. Exported so the tiers are assertable, not magic numbers. */
export const RANK = {
  EXACT: 0,
  STARTS_WITH: 1,
  WORD_START: 2,
  CONTAINS: 3,
  FUZZY: 4,
  NO_MATCH: 5,
} as const;

/**
 * Fold to a comparable key: lowercase, diacritics stripped, whitespace collapsed.
 *
 * `NFD` + combining-mark removal is enough for correctly-encoded names, so
 * `Biñan` is found by typing `binyan`. Encoding damage is repaired upstream in
 * the provider adapter, so it should not reach here at all; the fuzzy tier
 * below is the safety net if some future source ever ships mangled bytes. This
 * module still never guesses at spelling - it only ever compares.
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bounded Levenshtein. Only consulted for short queries, where "one or two
 * characters off" is a plausible typo and an O(n*m) scan is free.
 */
function editDistanceWithin(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  const row = (length: number, fill: (i: number) => number) =>
    Array.from({ length: length + 1 }, (_, i) => fill(i));
  let previous = row(b.length, (i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = row(b.length, () => 0);
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (current[j - 1] ?? i + j) + 1,
        (previous[j] ?? i + j) + 1,
        (previous[j - 1] ?? i + j) + cost,
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    // Every cell already exceeds the limit: no path can come back under it.
    if (rowMin > limit) return false;
    previous = current;
  }
  return (previous[b.length] ?? Infinity) <= limit;
}

/** Is every query character present, in order? ("cLn" finds "Calauan".) */
function isSubsequence(query: string, candidate: string): boolean {
  let i = 0;
  for (const ch of candidate) {
    if (ch === query[i]) i += 1;
    if (i === query.length) return true;
  }
  return false;
}

/**
 * Edit tolerance scales with the query so a 2-character query is not allowed to
 * match half the country, and a long query is not forced into a typo guess.
 */
function fuzzyLimit(queryLength: number): number {
  if (queryLength <= 3) return 1;
  if (queryLength <= 6) return 2;
  return 3;
}

function scoreOf(name: string, needle: string): number {
  if (!needle) return RANK.EXACT; // browsing: everything is equally shown
  const haystack = normalizeForMatch(name);
  if (haystack === needle) return RANK.EXACT;
  if (haystack.startsWith(needle)) return RANK.STARTS_WITH;
  if (haystack.split(' ').some((word) => word.startsWith(needle))) return RANK.WORD_START;
  if (haystack.includes(needle)) return RANK.CONTAINS;

  const limit = fuzzyLimit(needle.length);
  if (
    isSubsequence(needle, haystack) ||
    editDistanceWithin(needle, haystack, limit) ||
    haystack.split(' ').some((w) => isSubsequence(needle, w) || editDistanceWithin(needle, w, limit))
  )
    return RANK.FUZZY;

  return RANK.NO_MATCH;
}

/**
 * Order options by textual relevance to `query`. An empty query is a browse, so
 * the list comes back complete and in provider order.
 */
export function rankOptions<T extends Rankable>(options: readonly T[], query: string): T[] {
  const needle = normalizeForMatch(query);
  if (!needle) return [...options];

  return options
    .map((option, index) => ({ option, index, score: scoreOf(option.name, needle) }))
    .filter((scored) => scored.score !== RANK.NO_MATCH)
    // `index` as the tie-break keeps the sort stable by construction rather than
    // relying on engine sort stability for determinism.
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((scored) => scored.option);
}