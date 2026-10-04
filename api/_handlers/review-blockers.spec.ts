import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  phase2World,
  phase2WorldTokens,
  SALE,
  TOKEN,
  UUID,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const forms = (await import('./official-forms.js')).default;
const reports = (await import('./reports.js')).default;

beforeEach(() => {
  holder.db = new FakeSupabase({
    tables: {
      ...phase2World({}),
      reservation_agreements: [],
      reservation_agreement_holders: [],
      reservation_agreement_schedule: [],
    },
    tokens: phase2WorldTokens(),
    rpcs: [{ fn: 'save_reservation_agreement', result: UUID.viewerStaff }],
  });
});

const primary = (name: string) => ({
  holderType: 'PRIMARY',
  name,
  address: 'unit 2, 123 rizal st.',
  contactNumber: '09171234567',
  email: 'QA@Example.COM',
});
async function save(name: string, secondaryName?: string) {
  const { res, state } = makeRes();
  await forms(
    makeReq({
      method: 'POST',
      familyPath: 'reservations',
      token: TOKEN.admin,
      body: {
        saleId: SALE.submitted,
        reservationDate: '2026-01-01',
        agreementDate: '2026-01-01',
        primarySignatureStatus: 'pending',
        primary: primary(name),
        ...(secondaryName
          ? { secondary: { ...primary(secondaryName), holderType: 'SECONDARY' } }
          : {}),
      },
    }),
    res,
  );
  return state;
}
async function report(query: Record<string, string> = {}) {
  const { res, state } = makeRes();
  await reports(makeReq({ familyPath: 'sales', token: TOKEN.admin, query }), res);
  return state;
}

describe('IST direct API validation', () => {
  it.each(['CLAUD123', '123CLAUD', '12345'])(
    'rejects numeric primary name %s before RPC',
    async (name) => {
      expect((await save(name)).status).toBe(400);
      expect(holder.db?.calls.some((c) => c.table === 'save_reservation_agreement')).toBe(false);
    },
  );
  it('rejects numeric secondary holder before RPC', async () => {
    expect((await save('CLAUD', 'CLAUD123')).status).toBe(400);
    expect(holder.db?.calls.some((c) => c.table === 'save_reservation_agreement')).toBe(false);
  });
  it.each(['CLAUD', 'CLAUD MARS', 'DELA CRUZ', "O'CONNOR", 'ANNE-MARIE', 'MARÍA'])(
    'accepts %s and sends normalized arguments',
    async (name) => {
      expect((await save(name.toLowerCase())).status).toBe(201);
      const call = holder.db?.calls.find((c) => c.table === 'save_reservation_agreement');
      expect(call?.arg).toMatchObject({
        p_primary: {
          name: name.toLowerCase(),
          address: 'UNIT 2, 123 RIZAL ST.',
          email: 'qa@example.com',
          contactNumber: '+639171234567',
        },
      });
    },
  );
});

describe('sales report search before screen pagination and summary', () => {
  it('returns no rows and zero totals for a nonexistent literal term', async () => {
    const state = await report({ search: '__NO_SUCH_RECORD__', limit: '1' });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      data: [],
      meta: { total: 0 },
      summary: { sales: 0, grossFrozenValue: '0.00', verifiedPaid: '0.00' },
    });
  });
  it.each(['search target', 'TARGET', 'cus-search', 'sale-match'])(
    'matches supported human/reference fields case-insensitively: %s',
    async (search) => {
      const sale = holder.db!.rows('card_sales')[0]!;
      sale.sale_number = 'SALE-MATCH';
      sale.created_at = '2026-12-01T00:00:00Z';
      const customer = holder.db!.rows('customers').find((r) => r.id === sale.customer_id)!;
      Object.assign(customer, {
        first_name: 'Search',
        middle_name: '',
        last_name: 'Target',
        suffix: '',
        customer_number: 'CUS-SEARCH',
      });
      const state = await report({ search, limit: '1' });
      expect(state.status).toBe(200);
      expect(state.body).toMatchObject({
        data: [expect.objectContaining({ saleNumber: 'SALE-MATCH' })],
      });
    },
  );
  it('composes search with date/status and retains deterministic descending date sort', async () => {
    const sales = holder.db!.rows('card_sales');
    sales.forEach((row, i) =>
      Object.assign(row, {
        sale_number: `MATCH-${i}`,
        created_at: `2026-01-0${i + 1}T00:00:00Z`,
        status: i === 1 ? 'cancelled' : 'submitted',
      }),
    );
    const state = await report({
      search: 'match',
      status: 'submitted',
      from: '2026-01-02',
      to: '2026-01-05',
      limit: '1',
      offset: '1',
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      data: [expect.objectContaining({ saleNumber: 'MATCH-3' })],
      meta: { total: 3 },
      summary: { sales: 3 },
    });
  });
  it('finds a match beyond the first database batch rather than filtering a capped subset', async () => {
    const sales = holder.db!.rows('card_sales');
    const template = { ...sales[0]! };
    sales.splice(
      0,
      sales.length,
      ...Array.from({ length: 501 }, (_, i) => ({
        ...template,
        id: `review-sale-${i}`,
        sale_number: i === 500 ? 'MATCH-BEYOND-BATCH' : `OTHER-${i}`,
        created_at: i === 500 ? '2025-01-01T00:00:00Z' : '2026-01-01T00:00:00Z',
      })),
    );
    const state = await report({ search: 'match-beyond', limit: '1' });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      data: [expect.objectContaining({ saleNumber: 'MATCH-BEYOND-BATCH' })],
      meta: { total: 1 },
      summary: { sales: 1 },
    });
  });
});
