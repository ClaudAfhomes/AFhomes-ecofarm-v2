import { saleTeamLookupSchema } from '@afhomes/contracts';
import type { Db } from './handler-kit.js';

/** Call only after the enclosing directory has authorized and scoped its rows. */
export async function storedAccreditationNumbers(db: Db, staffIds: string[]) {
  const numbers = new Map<string, string | null>();
  const ids = [...new Set(staffIds)];
  // The existing RPC accepts one owner; bound concurrency without adding database objects.
  for (let start = 0; start < ids.length; start += 10) {
    await Promise.all(
      ids.slice(start, start + 10).map(async (id) => {
        const result = await db.rpc('get_sale_team_accreditation', { p_staff_id: id });
        if (result.error) throw result.error;
        const record = saleTeamLookupSchema.parse(result.data);
        numbers.set(id, record?.aaNumber ?? null);
      }),
    );
  }
  return numbers;
}
