import { describe, expect, it, vi } from 'vitest';
import { matchesSearch, readSearchRows } from './list-search.js';

describe('literal authorized-list search', () => {
  it.each(['%', '_', 'a,b', '(test)', '"quoted"'])('treats %s as literal text', (term) => {
    expect(matchesSearch(term, ['ordinary text'])).toBe(false);
    expect(matchesSearch(term, [`prefix ${term} suffix`])).toBe(true);
  });
  it('restores defaults for an empty term and ignores non-string values', () => {
    expect(matchesSearch('  ', [])).toBe(true);
    expect(matchesSearch('123', [123, null, { secret: '123' }])).toBe(false);
  });
  it('finds a match beyond two database batches without truncating totals', async () => {
    const data = Array.from({ length: 1001 }, (_, id) => ({
      id: String(id),
      name: id === 1000 ? 'LAST MATCH' : 'other',
    }));
    const range = vi.fn(async (from: number, to: number) => ({
      data: data.slice(from, to + 1),
      error: null,
    }));
    const rows = await readSearchRows({ range });
    expect(rows).toHaveLength(1001);
    expect(rows.filter((row) => matchesSearch('last', [row.name]))).toEqual([data[1000]]);
    expect(range.mock.calls).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
  });
  it('fails closed when a later database batch fails', async () => {
    const error = new Error('database failed');
    const range = vi
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({ length: 500 }, () => ({ id: 'row' })),
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error });
    await expect(readSearchRows({ range })).rejects.toBe(error);
  });
});
