import { describe, expect, it } from 'vitest';
import { FakeSupabase } from './testing/supabase-fake.js';
import { withCustomerCategories } from './customer-categories.js';
import type { Db } from './handler-kit.js';

describe('normal customer categories after import', () => {
  it.each([
    ['active', 'ACTIVE_VIP'],
    ['suspended', 'SUSPENDED'],
    ['expired', 'EXPIRED'],
  ])('uses the normal %s membership for imported customers', async (status, category) => {
    const db = new FakeSupabase({
      tables: {
        memberships: [{ id: 'member', customer_id: 'customer', status, expires_at: '2099-01-01' }],
        card_sales: [],
        payments: [],
      },
    });
    const [row] = await withCustomerCategories(db as unknown as Db, [
      { id: 'customer', status: 'active', registration_source: 'bulk_import' },
    ]);
    expect(row.derivedCategory).toBe(category);
  });
  it('uses verified money and frozen sale terms before membership activation', async () => {
    const db = new FakeSupabase({
      tables: {
        memberships: [],
        card_sales: [
          {
            id: 'sale',
            customer_id: 'customer',
            status: 'payment_pending',
            cash_price_snapshot: '80000.00',
            required_initial_snapshot: '30000.00',
            reservation_fee_snapshot: '10000.00',
          },
        ],
        payments: [
          {
            id: 'a',
            sale_id: 'sale',
            customer_id: 'customer',
            status: 'verified',
            amount: '30000.00',
          },
          {
            id: 'b',
            sale_id: 'sale',
            customer_id: 'customer',
            status: 'recorded',
            amount: '50000.00',
          },
        ],
      },
    });
    const [row] = await withCustomerCategories(db as unknown as Db, [
      { id: 'customer', status: 'active' },
    ]);
    expect(row.derivedCategory).toBe('DOWN_PAYMENT_COMPLETED');
  });
});
