import type { Db } from './handler-kit.js';

type Row = Record<string, unknown>;
export async function importedAccountSales(
  db: Db,
  actorId: string,
  team = false,
  from?: string,
  to?: string,
): Promise<Row[]> {
  const { data, error } = await db.rpc('account_imported_sales', {
    p_actor_id: actorId,
    p_team: team,
    p_from: from ?? null,
    p_to: to ?? null,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Invalid account sales response');
  return data as Row[];
}
export const mergeAccountSales = (...groups: Row[][]): Row[] => [
  ...new Map(groups.flat().map((row) => [String(row.id), row])).values(),
];

export const attributedSellers = (sale: Row): string[] =>
  Array.isArray(sale.attributed_staff_ids)
    ? [...new Set(sale.attributed_staff_ids.map(String))]
    : [String(sale.seller_staff_id ?? sale.seller_ost_id)];
