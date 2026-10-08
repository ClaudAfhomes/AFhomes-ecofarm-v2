import { beforeEach, describe, expect, it, vi } from 'vitest';
import { purchaseReservationCreateSchema } from '@afhomes/contracts';
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

/**
 * Models the real baseline: sellers hold sales.card_sales view+create but NOT
 * update, so only the super admin passes an update check. That is the D2 gate the
 * purchase reservation lifecycle reuses unchanged.
 */
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
    if (action === 'update' && moduleKey === 'sales.card_sales')
      return token.includes('super-admin')
        ? { userId: '22222222-2222-4222-8222-222222222222', roleSlug: 'super_admin' }
        : denied(403, 'FORBIDDEN');
    if (token.includes('other-seller'))
      return { userId: '33333333-3333-4333-8333-333333333333', roleSlug: 'sales_manager' };
    if (token.includes('seller'))
      return { userId: '11111111-1111-4111-8111-111111111111', roleSlug: 'sales_manager' };
    return { userId: '22222222-2222-4222-8222-222222222222', roleSlug: 'super_admin' };
  },
}));

const forms = (await import('./official-forms.js')).default;

const APP_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const CUSTOMER_ID = 'cccccccc-0000-4000-8000-000000000003';
const TERMS_ID = '22222222-2222-4222-8222-222222222222';
const RES_ID = 'bbbbbbbb-0000-4000-8000-00000000000a';
const RESERVE_REQUEST = '44444444-4444-4444-8444-444444444444';

const applicationOriginBody = {
  origin: 'application',
  requestId: RESERVE_REQUEST,
  customerApplicationId: APP_ID,
  purchaseTermsId: TERMS_ID,
  reservationDate: '2026-10-07',
  agreementDate: '2026-10-07',
  primarySignatureStatus: 'pending',
  scheduleNotes: [],
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
    inclusions_snapshot: { items: ['Priority reservation: yes'] },
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
    primary_signature_status: 'pending',
    secondary_signature_status: null,
    status: 'draft',
    created_by: '11111111-1111-4111-8111-111111111111',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    submitted_at: null,
    executed_at: null,
    ...overrides,
  };
}

function install(
  options: {
    rows?: Record<string, unknown>[];
    rpcs?: { fn: string; result: unknown }[];
    rpcErrors?: Record<string, { code?: string; message: string }>;
  } = {},
) {
  holder.db = new FakeSupabase({
    tables: {
      customer_applications: [],
      reservation_agreements: options.rows ?? [reservationRow()],
      reservation_agreement_holders: [
        {
          agreement_id: RES_ID,
          holder_type: 'PRIMARY',
          name: 'Ana Dela Cruz',
          address: '1 Main',
          contact_number: '09171234567',
          email: 'ana@example.com',
        },
      ],
      reservation_agreement_schedule: [],
      audit_events: [],
      card_sales: [],
    } as never,
    rpcs: options.rpcs ?? [],
    rpcErrors: options.rpcErrors,
  });
  return holder.db as FakeSupabase;
}

async function call(
  opts: {
    path: string;
    method?: string;
    token?: string;
    body?: unknown;
  },
) {
  const { res, state } = makeRes();
  await forms(
    makeReq({
      method: opts.method ?? 'GET',
      familyPath: opts.path,
      body: opts.body,
      headers: { authorization: `Bearer ${opts.token ?? 'seller-token'}` },
    }) as never,
    res as never,
  );
  return state as { status: number; body: unknown };
}

const rpcCalls = (db: FakeSupabase, fn: string) => db.calls.filter((c) => c.table === fn);

describe('application-origin reservation (no card sale)', () => {
  beforeEach(() =>
    install({ rpcs: [{ fn: 'reserve_application_purchase_once', result: RES_ID }] }),
  );

  it('the create contract needs no sale id at all', () => {
    expect(purchaseReservationCreateSchema.safeParse(applicationOriginBody).success).toBe(true);
    // A browser-supplied sale id on the application-origin branch is rejected:
    // this path creates the first commercial document, not a derived one.
    expect(
      purchaseReservationCreateSchema.safeParse({
        ...applicationOriginBody,
        saleId: 'eeeeeeee-0000-4000-8000-000000000005',
      }).success,
    ).toBe(false);
  });

  it('creates the reservation from an approved application and its exact terms', async () => {
    const response = await call({
      path: 'reservations',
      method: 'POST',
      body: applicationOriginBody,
    });
    expect(response.status).toBe(201);
    const calls = rpcCalls(holder.db as FakeSupabase, 'reserve_application_purchase_once');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arg).toMatchObject({
      p_application_id: APP_ID,
      p_terms_id: TERMS_ID,
      p_request_id: RESERVE_REQUEST,
    });
    // No sale anywhere in the payload: the RPC derives it, never receives it.
    expect(JSON.stringify(calls[0]?.arg)).not.toContain('saleId');
    expect((holder.db as FakeSupabase).calls.some((c) => c.table === 'card_sales')).toBe(false);
  });

  it('rejects a browser-supplied price, commission or source field', async () => {
    for (const extra of [
      { totalPrice: '1.00' },
      { expectedCommission: '1.00' },
      { saleId: 'eeeeeeee-0000-4000-8000-000000000005' },
      { status: 'executed' },
      { sellerStaffId: '33333333-3333-4333-8333-333333333333' },
    ]) {
      install({ rpcs: [{ fn: 'reserve_application_purchase_once', result: RES_ID }] });
      const response = await call({
        path: 'reservations',
        method: 'POST',
        body: { ...applicationOriginBody, ...extra },
      });
      expect(response.status).toBe(400);
      expect((holder.db as FakeSupabase).calls.some((c) => c.op === 'rpc')).toBe(false);
    }
  });

  it('replays the same request to the same RPC with an identical payload', async () => {
    const first = await call({ path: 'reservations', method: 'POST', body: applicationOriginBody });
    const replay = await call({ path: 'reservations', method: 'POST', body: applicationOriginBody });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    const calls = rpcCalls(holder.db as FakeSupabase, 'reserve_application_purchase_once');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.arg).toEqual(calls[1]?.arg);
  });

  it('requires a request id', async () => {
    const response = await call({
      path: 'reservations',
      method: 'POST',
      body: { ...applicationOriginBody, requestId: undefined },
    });
    expect(response.status).toBe(400);
  });

  it('surfaces every eligibility refusal as a domain conflict, not a generic failure', async () => {
    for (const code of [
      'APPLICATION_NOT_APPROVED',
      'PURCHASE_TERMS_REVIEW_REQUIRED',
      'PURCHASE_TERMS_VERSION_CONFLICT',
      'RESERVATION_ALREADY_EXISTS',
      'CUSTOMER_NOT_ELIGIBLE',
    ]) {
      install({
        rpcErrors: { reserve_application_purchase_once: { code: '55000', message: code } },
      });
      const response = await call({
        path: 'reservations',
        method: 'POST',
        body: applicationOriginBody,
      });
      expect(response.status).toBe(409);
    }
    install({
      rpcErrors: {
        reserve_application_purchase_once: { code: 'P0002', message: 'APPLICATION_NOT_FOUND' },
      },
    });
    expect(
      (await call({ path: 'reservations', method: 'POST', body: applicationOriginBody })).status,
    ).toBe(404);
  });

  it('surfaces an invalid seller as forbidden, never as a silent self-sale', async () => {
    for (const code of ['SELLER_NOT_IN_YOUR_DOWNLINE', 'SELLER_ROLE_NOT_A_SELLER', 'SELLER_INACTIVE']) {
      install({
        rpcErrors: { reserve_application_purchase_once: { code: '42501', message: code } },
      });
      const response = await call({
        path: 'reservations',
        method: 'POST',
        body: applicationOriginBody,
      });
      expect(response.status).toBe(403);
    }
  });

  it('refuses an unauthorized actor before any row is read', async () => {
    install();
    const response = await call({
      path: 'reservations',
      method: 'POST',
      body: applicationOriginBody,
      token: 'forbidden-token',
    });
    expect(response.status).toBe(403);
    expect((holder.db as FakeSupabase).calls.some((c) => c.op === 'rpc')).toBe(false);
  });
});

describe('application-origin reservation lifecycle', () => {
  const withStatus = (status: string, extra: Record<string, unknown> = {}) =>
    install({
      rows: [reservationRow({ status, ...extra })],
      rpcs: [{ fn: 'transition_purchase_reservation_once', result: RES_ID }],
    });

  it('submits, executes and reopens through one atomic transition RPC', async () => {
    for (const [action, body, path] of [
      ['submit', undefined, `reservations/${RES_ID}/submit`],
      ['execute', { decision: 'executed' }, `reservations/${RES_ID}/decision`],
      ['reopen', undefined, `reservations/${RES_ID}/reopen`],
      ['cancel', { decision: 'cancelled' }, `reservations/${RES_ID}/decision`],
    ] as const) {
      const db = withStatus('submitted');
      const response = await call({ path, method: 'POST', body: body ?? {}, token: 'super-admin-token' });
      expect(response.status).toBe(200);
      expect(rpcCalls(db, 'transition_purchase_reservation_once')[0]?.arg).toMatchObject({
        p_action: action,
        p_reservation_id: RES_ID,
      });
      // The handler never writes the status itself: the transition is atomic.
      expect(db.calls.some((c) => c.op === 'update' && c.table === 'reservation_agreements')).toBe(
        false,
      );
      expect(db.calls.some((c) => c.op === 'insert' && c.table === 'audit_events')).toBe(false);
    }
  });

  it('updates only agreement fields, never the commercial source', async () => {
    const db = withStatus('draft');
    const response = await call({
      path: `reservations/${RES_ID}`,
      method: 'PATCH',
      token: 'super-admin-token',
      body: { requestId: RESERVE_REQUEST, primarySignatureStatus: 'received', revisionNumber: 'R1' },
    });
    expect(response.status).toBe(200);
    expect(rpcCalls(db, 'transition_purchase_reservation_once')[0]?.arg).toMatchObject({
      p_action: 'save',
    });
  });

  it('rejects an update that tries to move commercial or source fields', async () => {
    for (const extra of [
      { purchaseTermsId: '99999999-9999-4999-8999-999999999999' },
      { customerId: '99999999-9999-4999-8999-999999999999' },
      { totalPrice: '1.00' },
      { saleId: 'eeeeeeee-0000-4000-8000-000000000005' },
      { status: 'executed' },
    ]) {
      const db = withStatus('draft');
      const response = await call({
        path: `reservations/${RES_ID}`,
        method: 'PATCH',
        token: 'super-admin-token',
        body: { requestId: RESERVE_REQUEST, primarySignatureStatus: 'received', ...extra },
      });
      expect(response.status).toBe(400);
      expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
    }
  });

  it('never lets another seller touch the agreement without the update grant', async () => {
    const db = install({
      rows: [reservationRow({ created_by: '33333333-3333-4333-8333-333333333333' })],
      rpcs: [{ fn: 'transition_purchase_reservation_once', result: RES_ID }],
    });
    const response = await call({
      path: `reservations/${RES_ID}/submit`,
      method: 'POST',
      token: 'seller-token',
    });
    expect(response.status).toBe(403);
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false);
  });

  it('refuses a lifecycle jump and a signature-less execution', async () => {
    for (const [code, expected, rowStatus, path, body] of [
      ['INVALID_AGREEMENT_TRANSITION', 409, 'draft', `reservations/${RES_ID}/reopen`, {}],
      [
        'PRIMARY_SIGNATURE_REQUIRED',
        400,
        'submitted',
        `reservations/${RES_ID}/decision`,
        { decision: 'executed' },
      ],
      [
        'SECONDARY_SIGNATURE_REQUIRED',
        400,
        'submitted',
        `reservations/${RES_ID}/decision`,
        { decision: 'executed' },
      ],
    ] as const) {
      install({
        rows: [reservationRow({ status: rowStatus })],
        rpcErrors: { transition_purchase_reservation_once: { code: '22023', message: code } },
      });
      const response = await call({ path, method: 'POST', body, token: 'super-admin-token' });
      expect(response.status).toBe(expected);
    }
  });

  it('never routes a sale-origin reservation into the purchase lifecycle RPC', async () => {
    const db = install({
      rows: [reservationRow({ origin: 'sale', sale_id: 'eeeeeeee-0000-4000-8000-000000000005' })],
      rpcs: [{ fn: 'submit_reservation_agreement', result: RES_ID }],
    });
    const response = await call({
      path: `reservations/${RES_ID}/submit`,
      method: 'POST',
      token: 'super-admin-token',
    });
    expect(response.status).toBe(200);
    expect(rpcCalls(db, 'transition_purchase_reservation_once')).toHaveLength(0);
    expect(rpcCalls(db, 'submit_reservation_agreement')).toHaveLength(1);
  });
});

describe('legacy sale-origin reservations keep working', () => {
  const legacyRow = () =>
    reservationRow({
      origin: 'sale',
      sale_id: 'eeeeeeee-0000-4000-8000-000000000005',
      customer_application_id: null,
      customer_id: null,
      seller_staff_id: null,
      purchase_terms_id: null,
      status: 'submitted',
    });

  it('still creates through the existing sale-origin wrapper', async () => {
    install({
      rpcs: [{ fn: 'reserve_from_customer_application_once', result: RES_ID }],
    });
    const response = await call({
      path: 'reservations',
      method: 'POST',
      body: {
        requestId: RESERVE_REQUEST,
        saleId: 'eeeeeeee-0000-4000-8000-000000000005',
        customerApplicationId: APP_ID,
        reservationDate: '2026-10-07',
        agreementDate: '2026-10-07',
        primarySignatureStatus: 'received',
        primary: {
          holderType: 'PRIMARY',
          name: 'Ana Dela Cruz',
          address: '1 Main',
          contactNumber: '09171234567',
          email: 'ana@example.com',
        },
        scheduleNotes: [],
      },
      // The legacy wrapper still authorizes the sale seller or a reviewer with
      // sales.card_sales update, so this call is made as the super admin.
      token: 'super-admin-token',
    });
    expect(response.status).toBe(201);
    expect(
      rpcCalls(holder.db as FakeSupabase, 'reserve_from_customer_application_once'),
    ).toHaveLength(1);
  });

  it('still submits through the existing legacy RPC, never the purchase one', async () => {
    const db = install({
      rows: [legacyRow()],
      rpcs: [{ fn: 'submit_reservation_agreement', result: RES_ID }],
    });
    const response = await call({ path: `reservations/${RES_ID}/submit`, method: 'POST' });
    expect(response.status).toBe(200);
    expect(rpcCalls(db, 'submit_reservation_agreement')).toHaveLength(1);
    expect(rpcCalls(db, 'transition_purchase_reservation_once')).toHaveLength(0);
  });
});
