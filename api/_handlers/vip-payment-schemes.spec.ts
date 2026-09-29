/**
 * VIP Stage 1 payment schemes - handler coverage.
 *
 * Drives the real sale/report/queue handlers against the in-memory Supabase
 * fake with Stage-1 plan economics (Bronze 54k/72k, Silver 192k/240k, Gold
 * 312k/390k, reservation 10k, validity 7/12/22y). The transactional RPCs stay
 * scripted; their SQL is proven by `pnpm test:db:local`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  PRODUCT,
  TOKEN,
  UNIQUE,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
let counter = 0;

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: (res: { status: (c: number) => { json: (b: unknown) => void } }, rows: unknown[]) =>
    res.status(200).json({ data: rows, meta: { total: rows.length } }),
  methodNotAllowed: () => {},
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

const handlers = {
  sales: (await import('./sales.js')).default,
  queues: (await import('./queues.js')).default,
  reports: (await import('./reports.js')).default,
  cards: (await import('./cards.js')).default,
};

const VIP_PLANS = [
  {
    id: PRODUCT.bronze,
    category_id: '99999999-9999-4999-8999-999999999999',
    code: 'BRONZE',
    name: 'Bronze',
    cash_price: '54000.00',
    installment_price: '72000.00',
    reservation_fee: '10000.00',
    spot_cash_days: 7,
    standard_installment_months: 4,
    validity_years: 7,
    move_a_enabled: true,
    move_b1_enabled: false,
    move_b2_enabled: false,
    minimum_down_payment: '10000.00',
    yearly_points: 25000,
    commission_rate: '0.04',
    description: null,
    is_active: true,
    sort_order: 30,
  },
  {
    id: PRODUCT.silver,
    category_id: '99999999-9999-4999-8999-999999999999',
    code: 'SILVER',
    name: 'Silver',
    cash_price: '192000.00',
    installment_price: '240000.00',
    reservation_fee: '10000.00',
    spot_cash_days: 7,
    standard_installment_months: 4,
    validity_years: 12,
    move_a_enabled: true,
    move_b1_enabled: true,
    move_b2_enabled: true,
    minimum_down_payment: '15000.00',
    yearly_points: 40000,
    commission_rate: '0.04',
    description: null,
    is_active: true,
    sort_order: 20,
  },
  {
    id: PRODUCT.gold,
    category_id: '99999999-9999-4999-8999-999999999999',
    code: 'GOLD',
    name: 'Gold',
    cash_price: '312000.00',
    installment_price: '390000.00',
    reservation_fee: '10000.00',
    spot_cash_days: 7,
    standard_installment_months: 4,
    validity_years: 22,
    move_a_enabled: true,
    move_b1_enabled: true,
    move_b2_enabled: true,
    minimum_down_payment: '20000.00',
    yearly_points: 60000,
    commission_rate: '0.04',
    description: null,
    is_active: true,
    sort_order: 10,
  },
];

const extraCustomer = (n: number) => ({
  id: `aaaaaaaa-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
  customer_number: `CUS-900${n}`,
  first_name: 'Prospect',
  middle_name: null,
  last_name: `Vip${n}`,
  suffix: null,
  email: `vip${n}@example.com`,
  phone: '+639171234567',
  birth_date: '1990-01-01',
  address: null,
  government_id_type: null,
  government_id_number: null,
  status: 'prospect',
  referred_by_staff_id: null,
  notes: null,
  auth_user_id: null,
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

function install() {
  counter += 1;
  const world = phase2World({
    card_plans: VIP_PLANS as never,
    customers: [
      ...((phase2World({}).customers ?? []) as unknown[]),
      ...Array.from({ length: 12 }, (_, i) => extraCustomer(i + 1)),
    ] as never,
  });
  holder.db = new FakeSupabase({
    tables: world,
    tokens: { ...phase2WorldTokens() },
    unique: UNIQUE,
    links: LINKS as never,
    rpcs: [
      { fn: 'next_customer_number', result: [{ customer_number: `CUS-${900000 + counter}` }] },
      { fn: 'next_sale_number', result: [{ sale_number: `SALE-${900000 + counter}` }] },
      { fn: 'record_card_payment', result: `pay-${counter}` },
    ],
    defaults: { staff_invitations: { status: 'pending' } },
  });
  return holder.db as FakeSupabase;
}

type State = { status: number; body: unknown };

async function call(
  family: keyof typeof handlers,
  options: { path: string; method?: string; token?: string; body?: unknown; query?: Record<string, string> },
): Promise<State> {
  const { res, state } = makeRes();
  await handlers[family](
    makeReq({
      method: options.method ?? 'GET',
      familyPath: options.path,
      body: options.body,
      token: options.token,
      query: options.query,
    }) as never,
    res as never,
  );
  return state;
}

const err = (body: unknown) => (body as { error: { code: string; message: string } }).error;

const CUSTOMERS = [
  CUSTOMER.prospect,
  CUSTOMER.prospectTwo,
  ...Array.from({ length: 10 }, (_, i) => `aaaaaaaa-0000-4000-8000-0000000001${String(i + 1).padStart(2, '0')}`),
];
let customerCursor = 0;
const nextCustomer = () => CUSTOMERS[customerCursor++ % CUSTOMERS.length]!;

async function createSale(productId: string, paymentScheme?: string) {
  const body: Record<string, string> = { customerId: nextCustomer(), productId };
  if (paymentScheme) body.paymentScheme = paymentScheme;
  return call('sales', { method: 'POST', path: '', token: TOKEN.admin, body });
}

describe('VIP sale creation freezes scheme economics', () => {
  beforeEach(() => {
    install();
    customerCursor = 0;
  });

  it('defaults to Spot Cash with the spot total and reservation snapshots', async () => {
    const db = install();
    const state = await createSale(PRODUCT.gold);
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({
      paymentScheme: 'spot_cash',
      cashPrice: '312000.00',
      reservationFee: '10000.00',
      requiredInitial: '10000.00',
      installmentMonths: null,
      monthlyAmount: null,
      validityMonths: 264,
      expectedCommission: '12480.00',
      status: 'submitted',
    });
    const sale = db.rows('card_sales').find((r) => r.id === (state.body as { id: string }).id)!;
    expect(sale).toMatchObject({
      payment_scheme: 'spot_cash',
      cash_price_snapshot: '312000.00',
      reservation_fee_snapshot: '10000.00',
      required_initial_snapshot: '10000.00',
      installment_months_snapshot: null,
      monthly_amount_snapshot: null,
      validity_months_snapshot: 264,
      expected_commission_snapshot: '12480.00',
    });
    const commission = db.rows('commissions').find((c) => c.sale_id === sale.id)!;
    expect(commission).toMatchObject({
      basis_amount_snapshot: '312000.00',
      amount: '12480.00',
      status: 'pending',
    });
  });

  it.each([
    ['Bronze Move A', PRODUCT.bronze, 'move_a', '54000.00', '10000.00', 4, '11000.00', 84, '2160.00'],
    ['Silver Move A', PRODUCT.silver, 'move_a', '192000.00', '10000.00', 4, '45500.00', 144, '7680.00'],
    ['Bronze installment', PRODUCT.bronze, 'installment_4_month', '72000.00', '10000.00', 4, '15500.00', 84, '2880.00'],
    ['Silver installment', PRODUCT.silver, 'installment_4_month', '240000.00', '10000.00', 4, '57500.00', 144, '9600.00'],
    ['Gold installment', PRODUCT.gold, 'installment_4_month', '390000.00', '10000.00', 4, '95000.00', 264, '15600.00'],
    ['Silver B1', PRODUCT.silver, 'move_b1_40_12', '240000.00', '96000.00', 12, '12000.00', 144, '9600.00'],
    ['Gold B1', PRODUCT.gold, 'move_b1_40_12', '390000.00', '156000.00', 12, '19500.00', 264, '15600.00'],
    ['Silver B2', PRODUCT.silver, 'move_b2_25_12', '240000.00', '60000.00', 12, '15000.00', 144, '9600.00'],
    ['Gold B2', PRODUCT.gold, 'move_b2_25_12', '390000.00', '97500.00', 12, '24375.00', 264, '15600.00'],
  ])(
    '%s freezes total/initial/months/monthly/validity/commission',
    async (_name, productId, scheme, total, initial, months, monthly, validity, commission) => {
      install();
      const state = await createSale(productId, scheme);
      expect(state.status).toBe(201);
      expect(state.body).toMatchObject({
        paymentScheme: scheme,
        cashPrice: total,
        reservationFee: '10000.00',
        requiredInitial: initial,
        installmentMonths: months,
        monthlyAmount: monthly,
        validityMonths: validity,
        expectedCommission: commission,
      });
    },
  );

  it('rejects Bronze B1 with a clear validation error and creates nothing', async () => {
    const db = install();
    const before = db.rows('card_sales').length;
    const state = await createSale(PRODUCT.bronze, 'move_b1_40_12');
    expect(state.status).toBe(409);
    expect(err(state.body).message).toMatch(/not available for the Bronze tier/i);
    expect(db.rows('card_sales')).toHaveLength(before);
  });

  it('rejects Bronze B2 with a clear validation error', async () => {
    const state = await createSale(PRODUCT.bronze, 'move_b2_25_12');
    expect(state.status).toBe(409);
    expect(err(state.body).message).toMatch(/not available for the Bronze tier/i);
  });

  it('rejects an unknown scheme code at the contract boundary', async () => {
    const state = await createSale(PRODUCT.gold, 'move_c');
    expect(state.status).toBe(400);
  });

  it('a later plan price edit leaves the frozen sale unchanged', async () => {
    const db = install();
    const created = await createSale(PRODUCT.silver, 'move_b1_40_12');
    expect(created.status).toBe(201);
    const saleId = (created.body as { id: string }).id;
    const edit = await call('cards', {
      method: 'PATCH',
      path: PRODUCT.silver,
      token: TOKEN.admin,
      body: { cashPrice: '999999.00', installmentPrice: '999999.00' },
    });
    expect(edit.status).toBe(200);
    const detail = await call('sales', { path: saleId, token: TOKEN.admin });
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      paymentScheme: 'move_b1_40_12',
      cashPrice: '240000.00',
      requiredInitial: '96000.00',
      monthlyAmount: '12000.00',
      expectedCommission: '9600.00',
    });
    const summary = await call('sales', { path: `${saleId}/summary`, token: TOKEN.admin });
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      paymentScheme: 'move_b1_40_12',
      cashPrice: '240000.00',
      reservationFee: '10000.00',
      requiredInitial: '96000.00',
      installmentMonths: 12,
      monthlyAmount: '12000.00',
    });
  });

  it('exposes the frozen scheme on the finance queue', async () => {
    await createSale(PRODUCT.gold, 'move_b2_25_12');
    const queue = await call('queues', { path: 'finance', token: TOKEN.admin });
    expect(queue.status).toBe(200);
    const rows = (queue.body as { data: Record<string, unknown>[] }).data;
    const row = rows.find((r) => r.cashPrice === '390000.00');
    expect(row).toMatchObject({
      paymentScheme: 'move_b2_25_12',
      reservationFee: '10000.00',
      requiredInitial: '97500.00',
      installmentMonths: 12,
      monthlyAmount: '24375.00',
      validityMonths: 264,
    });
  });

  it('shows the selected scheme label on the sales report', async () => {
    await createSale(PRODUCT.silver, 'move_b1_40_12');
    const report = await call('reports', {
      path: 'sales',
      token: TOKEN.superAdmin,
      query: {},
    });
    expect(report.status).toBe(200);
    const rows = (report.body as { data: Record<string, unknown>[] }).data;
    const row = rows.find((r) => r.frozenPrice === '240000.00');
    expect(row).toMatchObject({
      paymentScheme: 'Move B1 — 40% DP + 12 Months',
      reservationFee: '10000.00',
      requiredDown: '96000.00',
      installmentMonths: 12,
      monthlyAmount: '12000.00',
      validityMonths: 144,
    });
  });

  it('keeps points exactly as the plan snapshot (never invented)', async () => {
    const state = await createSale(PRODUCT.bronze, 'move_a');
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({ yearlyPoints: 25000 });
  });
});
