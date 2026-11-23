import { normalizeIdentifier } from './identifier.js';
import { z } from 'zod';
import type { Db } from './handler-kit.js';
const rowSchema = z.object({
  record: z.record(z.string(), z.unknown()),
  total_count: z.coerce.number().int().nonnegative(),
});
export async function customerDirectory(db: Db, filters: Record<string, unknown>) {
  const { data, error } = await db.rpc('customer_directory', {
    p_filters: {
      ...filters,
      identifier: typeof filters.search === 'string' ? normalizeIdentifier(filters.search) : '',
    },
  });
  if (error) throw error;
  return z.array(rowSchema).parse(data ?? []);
}
