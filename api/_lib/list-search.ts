/** Literal matching over explicit safe projections, after authorization and before pagination. */
export function matchesSearch(term: string | undefined, values: unknown[]): boolean {
  const needle = (term ?? '').trim().toLocaleLowerCase();
  return (
    !needle ||
    values.some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle))
  );
}

type PageQuery = {
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: Record<string, unknown>[] | null;
    error: unknown;
  }>;
};

/** Exhaust ordered authorized queries: a response cap must not hide matches. */
export async function readSearchRows(query: PageQuery): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

/** Bounded read: at most `limit` rows from an already-ordered query. Used by
 *  the finance merge path, which only needs a window (page size + offset) from
 *  each source before merging and slicing. Returns rows and the exact total
 *  count (from PostgREST `count: 'exact'`) so pagination metadata stays
 *  correct even when only a window was loaded.
 *
 *  Reads in 500-row chunks so a deep page (large `limit`) is not silently
 *  truncated by PostgREST's `max-rows` cap. */
export async function readBoundedRows(
  query: PageQuery,
  limit: number,
): Promise<{ rows: Record<string, unknown>[]; count: number | null }> {
  if (limit <= 0) return { rows: [], count: 0 };
  const rows: Record<string, unknown>[] = [];
  let count: number | null = null;
  for (let offset = 0; offset < limit; offset += 500) {
    const to = Math.min(offset + 499, limit - 1);
    const { data, error, count: pageCOUNT } = (await query.range(offset, to)) as {
      data: Record<string, unknown>[] | null;
      error: unknown;
      count?: number | null;
    };
    if (error) throw error;
    rows.push(...(data ?? []));
    if (pageCOUNT != null) count = pageCOUNT;
    if ((data ?? []).length < 500) break;
  }
  return { rows, count: count ?? rows.length };
}
