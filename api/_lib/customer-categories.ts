import { resolveCustomerCategory, type CustomerCategory } from '@afhomes/contracts';
import { addMoney } from '@afhomes/shared';
import type { Db } from './handler-kit.js';

/** Normal records only: import provenance never changes a business category. */
export async function withCustomerCategories(
  db: Db,
  customers: Record<string, unknown>[],
): Promise<Array<Record<string, unknown> & { derivedCategory: CustomerCategory }>> {
  if (customers.length === 0) return [];
  const ids = customers.map((row) => String(row.id));
  const { data: members, error: memberError } = await db
    .from('memberships')
    .select('customer_id,status,expires_at')
    .in('customer_id', ids);
  if (memberError) throw memberError;
  const memberByCustomer = new Map(
    ((members ?? []) as Record<string, unknown>[]).map((row) => [String(row.customer_id), row]),
  );
  const sales: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from('card_sales')
      .select(
        'id,customer_id,status,cash_price_snapshot,reservation_fee_snapshot,required_initial_snapshot,created_at',
      )
      .in('customer_id', ids)
      .order('created_at', { ascending: false })
      .range(offset, offset + 999);
    if (error) throw error;
    sales.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < 1000) break;
  }
  const saleByCustomer = new Map<string, Record<string, unknown>>();
  for (const sale of sales)
    if (sale.status !== 'cancelled' && !saleByCustomer.has(String(sale.customer_id)))
      saleByCustomer.set(String(sale.customer_id), sale);
  const paidByCustomer = new Map<string, string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from('payments')
      .select('customer_id,sale_id,amount')
      .in('customer_id', ids)
      .eq('status', 'verified')
      .order('id')
      .range(offset, offset + 999);
    if (error) throw error;
    for (const row of (data ?? []) as { customer_id: string; sale_id: string; amount: string }[])
      if (saleByCustomer.get(row.customer_id)?.id === row.sale_id)
        paidByCustomer.set(
          row.customer_id,
          addMoney(paidByCustomer.get(row.customer_id) ?? '0.00', row.amount),
        );
    if ((data ?? []).length < 1000) break;
  }
  return customers.map((row) => {
    const id = String(row.id);
    const sale = saleByCustomer.get(id);
    const member = memberByCustomer.get(id);
    const membershipStatus =
      member?.status === 'active' &&
      member.expires_at &&
      new Date(String(member.expires_at)).valueOf() <= Date.now()
        ? 'expired'
        : member?.status;
    return {
      ...row,
      derivedCategory: resolveCustomerCategory({
        customerStatus: String(row.status),
        membershipStatus: membershipStatus ? String(membershipStatus) : null,
        verifiedTotal: paidByCustomer.get(id) ?? '0.00',
        priceTotal: String(sale?.cash_price_snapshot ?? '0.00'),
        reservationFee: sale?.reservation_fee_snapshot
          ? String(sale.reservation_fee_snapshot)
          : undefined,
        requiredInitial: sale?.required_initial_snapshot
          ? String(sale.required_initial_snapshot)
          : undefined,
      }),
    };
  });
}
