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
