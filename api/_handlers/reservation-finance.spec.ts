import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reservationFinanceSummarySchema,
  financeCollectionQueueItemSchema,
} from '@afhomes/contracts';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: (res: { status: (c: number) => { json: (b: unknown) => void } }, rows: unknown[]) =>
    res.status(200).json({ data: rows, meta: { total: rows.length } }),
  methodNotAllowed: () => {},
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

/** Finance holds view+update on payment verification; a seller holds neither update. */
vi.mock('../_lib/afhomes-access.js', () => ({
  authorizeAfHomes: async (
    req: { headers?: Record<string, string> },
    moduleKey?: string,
    action?: string,
  ) => {
    const token = req.headers?.authorization ?? '';
    const denied = (status: number, code: string) => ({
      error: {
        error: { code, message: code === 'UNAUTHORIZED' ? 'Missing authentication' : 'Forbidden' },
        status,
      },
    });
    if (!token.replace(/^Bearer\s*/, '').trim()) return denied(401, 'UNAUTHORIZED');
    if (token.includes('forbidden')) return denied(403, 'FORBIDDEN');
    if (
      moduleKey === 'finance.payment_verification' &&
      action === 'update' &&
      !token.includes('finance')
    )
      return denied(403, 'FORBIDDEN');
    return { userId: '22222222-2222-4222-8222-222222222222', roleSlug: 'finance' };
  },
}));

const forms = (await import('./official-forms.js')).default;

const RES_ID = 'bbbbbbbb-0000-4000-8000-00000000000a';
const APP_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const CUSTOMER_ID = 'cccccccc-0000-4000-8000-000000000003';
const TERMS_ID = '22222222-2222-4222-8222-222222222222';
const PAYMENT_ID = '99999999-9999-4999-8999-999999999999';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';

const summary = {
  origin: 'reservation',
  reservationId: RES_ID,
  reservationNumber: 'AF-RES-ABCDE',
  customerApplicationId: APP_ID,
  purchaseTermsId: TERMS_ID,
  sellerStaffId: '11111111-1111-4111-8111-111111111111',
  customerId: CUSTOMER_ID,
  saleId: null,
  status: 'executed',
  tier: 'BRONZE',
  paymentScheme: 'spot_cash',
  totalPrice: '54000.00',
  reservationFee: '10000.00',
  requiredInitial: '10000.00',
  minimumDownPayment: '10000.00',
  installmentMonths: null,
  monthlyAmount: null,
  validityMonths: 84,
  recordedTotal: '10000.00',
  verifiedTotal: '0.00',
  rejectedTotal: '0.00',
  recordedPaymentCount: 1,
  remainingBalance: '54000.00',
  overpaidAmount: '0.00',
  fullyPaid: false,
  firstVerifiedPayment: null,
  spotCashDeadline: null,
};

function reservationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RES_ID,
    reservation_number: 'AF-RES-ABCDE',
    reservation_date: '2026-10-07',
    agreement_date: '2026-10-07',
    sale_id: null,
    origin: 'application',
    customer_application_id: APP_ID,
    customer_id: CUSTOMER_ID,
    seller_staff_id: '11111111-1111-4111-8111-111111111111',
    purchase_terms_id: TERMS_ID,
    plan_id: 'dddddddd-0000-4000-8000-000000000004',
    tier_snapshot: 'BRONZE',
    inclusions_snapshot: { items: [] },
    total_price_snapshot: '54000.00',
    reservation_fee_snapshot: '10000.00',
    down_payment_snapshot: '10000.00',
    total_payment_received_snapshot: '0.00',
    balance_snapshot: '54000.00',
    monthly_amortization_snapshot: null,
    installment_months_snapshot: null,
    payment_scheme_snapshot: 'spot_cash',
    discount_percent_snapshot: 15,
    validity_years_snapshot: 7,
    yearly_points_snapshot: 10000,
    annual_points_tranches_snapshot: 5,
    holder_limit_snapshot: 1,
    primary_signature_status: 'received',
    secondary_signature_status: null,
    status: 'executed',
    created_by: '11111111-1111-4111-8111-111111111111',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    submitted_at: new Date().toISOString(),
    executed_at: new Date().toISOString(),
    finalized_at: null,
    ...overrides,
  };
}

function install(
  options: {
    rows?: Record<string, unknown>[];
    payments?: Record<string, unknown>[];
    rpcs?: { fn: string; result: unknown }[];
    rpcErrors?: Record<string, { code?: string; message: string }>;
  } = {},
) {
  holder.db = new FakeSupabase({
    tables: {
      customer_applications: [
        { id: APP_ID, application_number: 'AF-APP-00000001', status: 'approved' },
      ],
      customers: [
        {
          id: CUSTOMER_ID,
          first_name: 'ANA',
          middle_name: null,
          last_name: 'CRUZ',
          suffix: null,
        },
      ],
      staff_users: [{ id: '11111111-1111-4111-8111-111111111111', full_name: 'Ana Seller' }],
      card_plans: [{ id: 'dddddddd-0000-4000-8000-000000000004', name: 'BRONZE VIP' }],
      reservation_agreements: options.rows ?? [reservationRow()],
      reservation_agreement_holders: [],
      reservation_agreement_schedule: [],
      payments: options.payments ?? [
        {
          id: PAYMENT_ID,
          payment_number: 'AF-PAY-AAAAA',
          origin: 'reservation',
          sale_id: null,
          reservation_id: RES_ID,
          customer_id: CUSTOMER_ID,
          amount: '10000.00',
          payment_type: 'down_payment',
          method: 'cash',
          reference: 'REF-1',
          notes: null,
          status: 'recorded',
          recorded_by: '22222222-2222-4222-8222-222222222222',
          verified_by: null,
          recorded_at: '2026-10-07T00:00:00.000Z',
          verified_at: null,
        },
      ],
      audit_events: [],
    } as never,
    rpcs: options.rpcs ?? [{ fn: 'purchase_financial_summary', result: summary }],
    rpcErrors: options.rpcErrors,
  });
  return holder.db as FakeSupabase;
}

async function call(opts: { path: string; method?: string; token?: string; body?: unknown }) {
  const { res, state } = makeRes();
  await forms(
    makeReq({
      method: opts.method ?? 'GET',
      familyPath: opts.path,
      body: opts.body,
      headers: { authorization: `Bearer ${opts.token ?? 'finance-token'}` },
    }) as never,
    res as never,
  );
  return state as { status: number; body: unknown };
}

const rpcCalls = (db: FakeSupabase, fn: string) => db.calls.filter((c) => c.table === fn);

describe('Finance collection against an executed reservation', () => {
  beforeEach(() => install());

  it('records one AF-PAY against the reservation with no sale id', async () => {
    install({
      rpcs: [
        { fn: 'record_reservation_payment_once', result: PAYMENT_ID },
        { fn: 'purchase_financial_summary', result: summary },
      ],
    });
    const response = await call({
      path: `reservations/${RES_ID}/payments`,
      method: 'POST',
      body: {
        requestId: REQUEST_ID,
        amount: '10000.00',
        paymentType: 'down_payment',
        method: 'cash',
      },
    });
    expect(response.status).toBe(201);
    const calls = rpcCalls(holder.db as FakeSupabase, 'record_reservation_payment_once');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arg).toMatchObject({
      p_reservation_id: RES_ID,
      p_request_id: REQUEST_ID,
      p_input: { amount: '10000.00', paymentType: 'down_payment', method: 'cash' },
    });
    // The sale is never supplied, never derived by the browser.
    expect(JSON.stringify(calls[0]?.arg)).not.toContain('saleId');
  });

  it('never lets the browser assert verified totals or a balance', async () => {
    for (const extra of [
      { verifiedTotal: '54000.00' },
      { remainingBalance: '0.00' },
      { status: 'verified' },
      { saleId: 'eeeeeeee-0000-4000-8000-000000000005' },
      { reservationId: '99999999-9999-4999-8999-999999999999' },
    ]) {
      install({ rpcs: [{ fn: 'record_reservation_payment_once', result: PAYMENT_ID }] });
      const response = await call({
        path: `reservations/${RES_ID}/payments`,
        method: 'POST',
        body: {
          requestId: REQUEST_ID,
          amount: '10000.00',
          paymentType: 'down_payment',
          method: 'cash',
          ...extra,
        },
      });
      expect(response.status).toBe(400);
      expect((holder.db as FakeSupabase).calls.some((c) => c.op === 'rpc')).toBe(false);
    }
  });

  it('rejects a non-positive amount before any row is written', async () => {
    install();
    for (const amount of ['0.00', '-1.00', '0']) {
      const response = await call({
        path: `reservations/${RES_ID}/payments`,
        method: 'POST',
        body: { requestId: REQUEST_ID, amount, paymentType: 'installment', method: 'cash' },
      });
      expect(response.status).toBe(400);
    }
    expect((holder.db as FakeSupabase).calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('requires the finance update grant', async () => {
    install();
    const response = await call({
      path: `reservations/${RES_ID}/payments`,
      method: 'POST',
      body: {
        requestId: REQUEST_ID,
        amount: '10000.00',
        paymentType: 'installment',
        method: 'cash',
      },
      token: 'seller-token',
    });
    expect(response.status).toBe(403);
    expect((holder.db as FakeSupabase).calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('reads the one ledger by reservation, never a second copy', async () => {
    const response = await call({ path: `reservations/${RES_ID}/payments` });
    expect(response.status).toBe(200);
    const rows = (response.body as { data: { origin: string; reservationId: string }[] }).data;
    expect(rows).toHaveLength(1);

    expect(rows[0]).toMatchObject({ origin: 'reservation', reservationId: RES_ID, saleId: null });
  });

  it('refuses a sale-origin agreement on the reservation finance routes', async () => {
    install({ rows: [reservationRow({ origin: 'sale' })] });
    for (const [path, method, body] of [
      [`reservations/${RES_ID}/payments`, 'GET', undefined],
      [`reservations/${RES_ID}/finance`, 'GET', undefined],
      [
        `reservations/${RES_ID}/payments`,
        'POST',
        { requestId: REQUEST_ID, amount: '10.00', paymentType: 'installment', method: 'cash' },
      ],
    ] as const) {
      const response = await call({ path, method, body });
      expect(response.status).toBe(404);
    }
  });

  it('surfaces every collection refusal as a domain conflict', async () => {
    for (const code of ['RESERVATION_NOT_EXECUTED', 'RESERVATION_FINALIZED']) {
      install({
        rpcErrors: {
          record_reservation_payment_once: { code: '55000', message: code },
        },
      });
      const response = await call({
        path: `reservations/${RES_ID}/payments`,
        method: 'POST',
        body: {
          requestId: REQUEST_ID,
          amount: '10.00',
          paymentType: 'installment',
          method: 'cash',
        },
      });
      expect(response.status).toBe(409);
    }
    install({
      rpcErrors: {
        record_reservation_payment_once: { code: 'P0002', message: 'AGREEMENT_NOT_FOUND' },
      },
    });
    expect(
      (
        await call({
          path: `reservations/${RES_ID}/payments`,
          method: 'POST',
          body: {
            requestId: REQUEST_ID,
            amount: '10.00',
            paymentType: 'installment',
            method: 'cash',
          },
        })
      ).status,
    ).toBe(404);
  });
});

describe('Finalizing a purchase', () => {
  const SALE_ID = '77777777-0000-4000-8000-000000000007';

  beforeEach(() => install());

  it('sends only a request id and a reservation: the browser asserts no economics', async () => {
    install({
      rpcs: [{ fn: 'finalize_reservation_purchase_once', result: SALE_ID }],
    });
    const response = await call({
      path: `reservations/${RES_ID}/finalize`,
      method: 'POST',
      body: { requestId: REQUEST_ID },
    });
    expect(response.status).toBe(200);
    const call0 = rpcCalls(holder.db as FakeSupabase, 'finalize_reservation_purchase_once')[0];
    expect(call0?.arg).toMatchObject({ p_reservation_id: RES_ID, p_request_id: REQUEST_ID });
    // Nothing the caller could assert: no price, no total, no seller, no sale id.
    expect(Object.keys(call0?.arg ?? {}).sort()).toEqual([
      'p_actor_id',
      'p_request_id',
      'p_reservation_id',
    ]);
  });

  it('rejects any browser-supplied economic figure before the RPC runs', async () => {
    for (const extra of [
      { saleId: SALE_ID },
      { totalPrice: '1.00' },
      { verifiedTotal: '54000.00' },
      { sellerStaffId: '11111111-1111-4111-8111-111111111111' },
      { commission: '9999.00' },
      { activate: true },
      { membershipId: SALE_ID },
    ]) {
      install();
      const response = await call({
        path: `reservations/${RES_ID}/finalize`,
        method: 'POST',
        body: { requestId: REQUEST_ID, ...extra },
      });
      expect(response.status).toBe(400);
      expect((holder.db as FakeSupabase).calls.some((c) => c.op === 'rpc')).toBe(false);
    }
  });

  it('never implies that finalization activated anything', async () => {
    install({ rpcs: [{ fn: 'finalize_reservation_purchase_once', result: SALE_ID }] });
    const response = await call({
      path: `reservations/${RES_ID}/finalize`,
      method: 'POST',
      body: { requestId: REQUEST_ID },
    });
    expect(response.body).toMatchObject({ saleId: SALE_ID, activationRequired: true });
  });

  it('requires the finance update grant', async () => {
    install();
    const response = await call({
      path: `reservations/${RES_ID}/finalize`,
      method: 'POST',
      body: { requestId: REQUEST_ID },
      token: 'seller-token',
    });
    expect(response.status).toBe(403);
    expect((holder.db as FakeSupabase).calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('maps every ineligibility refusal to a conflict', async () => {
    for (const code of [
      'RESERVATION_NOT_FULLY_PAID',
      'RESERVATION_UNDECIDED_PAYMENTS',
      'RESERVATION_NOT_EXECUTED',
      'RESERVATION_ALREADY_FINALIZED',
      'SALE_ALREADY_EXISTS',
    ]) {
      install({
        rpcErrors: { finalize_reservation_purchase_once: { code: '55000', message: code } },
      });
      const response = await call({
        path: `reservations/${RES_ID}/finalize`,
        method: 'POST',
        body: { requestId: REQUEST_ID },
      });
      expect(response.status).toBe(409);
    }
    // An inactive seller is an AUTHORIZATION answer, not a state conflict.
    install({
      rpcErrors: {
        finalize_reservation_purchase_once: { code: '42501', message: 'SELLER_INACTIVE' },
      },
    });
    expect(
      (
        await call({
          path: `reservations/${RES_ID}/finalize`,
          method: 'POST',
          body: { requestId: REQUEST_ID },
        })
      ).status,
    ).toBe(403);
    install({
      rpcErrors: {
        finalize_reservation_purchase_once: { code: 'P0002', message: 'AGREEMENT_NOT_FOUND' },
      },
    });
    expect(
      (
        await call({
          path: `reservations/${RES_ID}/finalize`,
          method: 'POST',
          body: { requestId: REQUEST_ID },
        })
      ).status,
    ).toBe(404);
  });

  it('refuses a sale-origin agreement', async () => {
    install({ rows: [reservationRow({ origin: 'sale' })] });
    const response = await call({
      path: `reservations/${RES_ID}/finalize`,
      method: 'POST',
      body: { requestId: REQUEST_ID },
    });
    expect(response.status).toBe(404);
    expect((holder.db as FakeSupabase).calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('reports an unknown reservation as missing, not forbidden', async () => {
    install({ rows: [] });
    const response = await call({
      path: `reservations/${RES_ID}/finalize`,
      method: 'POST',
      body: { requestId: REQUEST_ID },
    });
    expect(response.status).toBe(404);
  });
});

describe('Reservation finance summary', () => {
  // Its own fixture, not whatever the previous describe happened to leave behind:
  // a leaked `install()` is a test that passes for the wrong reason.
  beforeEach(() => install());

  it('returns the server totals with the included reservation amount', async () => {
    const response = await call({ path: `reservations/${RES_ID}/finance` });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reservationId: RES_ID,
      applicationNumber: 'AF-APP-00000001',
      applicationStatus: 'approved',
      sellerName: 'Ana Seller',
      customerName: 'ANA CRUZ',
      totalPrice: '54000.00',
      reservationFee: '10000.00',
      // Recorded but NOT verified: verified 0.00 with the FULL total remaining.
      verifiedTotal: '0.00',
      remainingBalance: '54000.00',
      fullyPaid: false,
      saleId: null,
    });
  });

  it('reports verified money and a shrunken balance once money is verified', async () => {
    install({
      rpcs: [
        {
          fn: 'purchase_financial_summary',
          result: {
            ...summary,
            verifiedTotal: '54000.00',
            recordedTotal: '54000.00',
            remainingBalance: '0.00',
            overpaidAmount: '0.00',
            fullyPaid: true,
            firstVerifiedPayment: '2026-10-07T02:00:00.000Z',
            spotCashDeadline: '2026-10-14T02:00:00.000Z',
          },
        },
      ],
    });
    const response = await call({ path: `reservations/${RES_ID}/finance` });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      verifiedTotal: '54000.00',
      remainingBalance: '0.00',
      fullyPaid: true,
      firstVerifiedPayment: '2026-10-07T02:00:00.000Z',
    });
  });

  it('answers 404 rather than inventing zeros when the summary is missing', async () => {
    install({ rpcs: [{ fn: 'purchase_financial_summary', result: null }] });
    const response = await call({ path: `reservations/${RES_ID}/finance` });
    expect(response.status).toBe(500);
  });
});
it('returns Finance read and record responses accepted by the browser contract', async () => {
  install();
  const read = await call({ path: `reservations/${RES_ID}/finance` });
  expect(reservationFinanceSummarySchema.safeParse(read.body).error).toBeUndefined();
  install({
    rpcs: [
      { fn: 'record_reservation_payment_once', result: PAYMENT_ID },
      { fn: 'purchase_financial_summary', result: summary },
    ],
  });
  const recorded = await call({
    path: `reservations/${RES_ID}/payments`,
    method: 'POST',
    body: {
      requestId: REQUEST_ID,
      amount: '10000.00',
      paymentType: 'down_payment',
      method: 'cash',
    },
  });
  expect(recorded.status).toBe(201);
  expect(reservationFinanceSummarySchema.safeParse(recorded.body).error).toBeUndefined();
});

it('returns a reservation Finance queue row accepted by the browser contract', async () => {
  install({
    rows: [reservationRow({ required_initial_snapshot: '10000.00', validity_months_snapshot: 84 })],
  });
  const db = holder.db as FakeSupabase;
  db.rows('reservation_agreements')[0]!.customer_applications = {
    application_number: 'AF-APP-00000001',
    status: 'approved',
  };
  db.rows('reservation_agreements')[0]!.customers = { first_name: 'ANA', last_name: 'CRUZ' };
  const queues = (await import('./queues.js')).default;
  const { res, state } = makeRes();
  await queues(
    makeReq({
      method: 'GET',
      familyPath: 'finance',
      headers: { authorization: 'Bearer finance-token' },
    }),
    res,
  );
  expect(state.status).toBe(200);
  const rows = (state.body as { data: unknown[] }).data;
  expect(rows).toHaveLength(1);
  const selection = db.calls.find(
    (call) => call.op === 'select' && call.table === 'reservation_agreements',
  );
  expect(
    (selection?.arg as { cols: string }).cols.split(',').map((column) => column.trim()),
  ).toContain('purchase_terms_id');
  expect(rows[0]).toMatchObject({ sellerName: 'Ana Seller' });
  expect(financeCollectionQueueItemSchema.safeParse(rows[0]).error).toBeUndefined();
});
it('verifies a reservation payment through the source-aware transaction', async () => {
  install({
    rpcs: [
      { fn: 'verify_purchase_payment_once', result: { paymentId: PAYMENT_ID } },
      { fn: 'purchase_financial_summary', result: summary },
    ],
  });
  const result = await call({
    path: `reservations/${RES_ID}/payments/${PAYMENT_ID}/verify`,
    method: 'POST',
    body: { requestId: REQUEST_ID, decision: 'verified' },
  });
  expect(result.status).toBe(200);
  expect(rpcCalls(holder.db as FakeSupabase, 'verify_purchase_payment_once')[0]?.arg).toMatchObject(
    {
      p_request_id: REQUEST_ID,
      p_payment_id: PAYMENT_ID,
      p_decision: 'verified',
      p_actor_id: '22222222-2222-4222-8222-222222222222',
    },
  );
});
