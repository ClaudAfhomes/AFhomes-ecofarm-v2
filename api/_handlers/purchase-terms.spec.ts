import { beforeEach, describe, expect, it, vi } from 'vitest';
import { purchaseTermsProposalSchema } from '@afhomes/contracts';
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

/** Models the real role baseline: sellers hold sales.customers view+create+update. */
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
    // A reviewer without the update grant: the SQL layer refuses, and so must the
    // handler, before any row is read.
    if (token.includes('no-update') && (moduleKey !== 'sales.customers' || action !== 'view'))
      return denied(403, 'FORBIDDEN');
    if (token.includes('seller'))
      return { userId: '11111111-1111-4111-8111-111111111111', roleSlug: 'sales_manager' };
    return { userId: '22222222-2222-4222-8222-222222222222', roleSlug: 'super_admin' };
  },
}));

const forms = (await import('./official-forms.js')).default;

const APP_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const CUSTOMER_ID = 'cccccccc-0000-4000-8000-000000000003';
const SELLER_ID = '11111111-1111-4111-8111-111111111111';
const HASH = 'a'.repeat(64);

const proposalTerms = {
  applicationId: APP_ID,
  customerId: CUSTOMER_ID,
  planId: 'dddddddd-0000-4000-8000-000000000004',
  sellerStaffId: SELLER_ID,
  captureKind: 'submission' as const,
  tier: 'BRONZE' as const,
  paymentScheme: 'spot_cash' as const,
  totalPrice: '54000.00',
  reservationFee: '10000.00',
  minimumDownPayment: '10000.00',
  requiredInitial: '10000.00',
  installmentMonths: null,
  monthlyAmount: null,
  spotCashDays: 7,
  validityMonths: 84,
  discountPercent: 15,
  yearlyPoints: 10000,
  annualPointsTranches: 5,
  holderLimit: 1,
  inclusions: ['Priority reservation: yes'],
  commissionRuleId: null,
  commissionRate: '0',
  commissionBase: '54000.00',
  expectedCommission: '0.00',
};
const proposal = {
  applicationId: APP_ID,
  expectedProposalHash: HASH,
  asOf: '2026-10-07T00:00:00.000Z',
  offerKind: 'submission' as const,
  terms: proposalTerms,
};
const reviewProposal = { ...proposal, offerKind: 'newly_confirmed_offer' as const };

const application = {
  id: APP_ID,
  application_number: 'AF-APP-00000001',
  customer_id: CUSTOMER_ID,
  sale_id: null,
  plan_id: proposalTerms.planId,
  purchase_terms_id: null,
  tier_snapshot: 'BRONZE',
  payment_scheme_snapshot: 'spot_cash',
  vip_amount_snapshot: '54000.00',
  discount_percent_snapshot: 15,
  validity_years_snapshot: 7,
  yearly_points_snapshot: 10000,
  annual_points_tranches_snapshot: 5,
  holder_limit_snapshot: 1,
  acquisition_channels: [],
  consent_acknowledged: true,
  acknowledged_at: '2026-10-01',
  primary_signature_status: 'received',
  secondary_signature_status: null,
  valid_id_received: true,
  reservation_payment_proof_received: false,
  status: 'draft',
  created_by: SELLER_ID,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  submitted_at: null,
  approved_at: null,
  rejected_at: null,
};

function install(
  options: {
    rpcs?: { fn: string; result: unknown }[];
    rpcErrors?: Record<string, { code?: string; message: string }>;
  } = {},
) {
  holder.db = new FakeSupabase({
    tables: {
      customer_applications: [{ ...application }],
      customer_application_holders: [],
      identity_documents: [
        {
          id: '11111111-0000-4000-8000-000000000010',
          subject_type: 'customer',
          customer_id: CUSTOMER_ID,
          storage_path: 'synthetic/id.png',
          sha256: 'b'.repeat(64),
          verification_status: 'pending_review',
          created_at: '2026-10-01',
          reviewed_data: { fields: { idType: 'passport' } },
        },
      ],
      staff_users: [{ id: SELLER_ID, full_name: 'QA SELLER' }],
      customers: [{ id: CUSTOMER_ID, created_by: SELLER_ID }],
      reservation_agreements: [],
      audit_events: [],
    } as never,
    rpcs: options.rpcs ?? [],
    rpcErrors: options.rpcErrors,
    // Submission reads the persisted current ID through the customer embed.
    links: [{ child: 'identity_documents', parent: 'customers', fk: 'customer_id' }],
  });
  return holder.db as FakeSupabase;
}

/** The RPC call for `fn`, not merely the last call: the handler reads back after it. */
const rpcCall = (db: FakeSupabase, fn: string) => db.calls.filter((c) => c.table === fn);

async function call(opts: {
  path: string;
  method?: string;
  token?: string;
  body?: unknown;
  query?: Record<string, string>;
}) {
  const { res, state } = makeRes();
  await forms(
    makeReq({
      method: opts.method ?? 'GET',
      familyPath: opts.path,
      body: opts.body,
      query: opts.query,
      headers: { authorization: `Bearer ${opts.token ?? 'seller-token'}` },
    }) as never,
    res as never,
  );
  return state as { status: number; body: unknown };
}

const requestId = '44444444-4444-4444-8444-444444444444';

describe('purchase terms proposal (server-authoritative offer)', () => {
  beforeEach(() => install({ rpcs: [{ fn: 'purchase_terms_proposal', result: proposal }] }));

  it('returns a strict typed proposal whose hash covers the shown offer', async () => {
    const response = await call({
      path: `customer-applications/${APP_ID}/purchase-terms/proposal`,
    });
    expect(response.status).toBe(200);
    expect(purchaseTermsProposalSchema.safeParse(response.body).success).toBe(true);
    expect(response.body).toMatchObject({
      sellerName: 'QA SELLER',
      expectedProposalHash: HASH,
      terms: { totalPrice: '54000.00', reservationFee: '10000.00' },
    });
  });

  it('passes a seller candidate as a request only, and never as an assertion', async () => {
    const candidate = '99999999-9999-4999-8999-999999999999';
    const response = await call({
      path: `customer-applications/${APP_ID}/purchase-terms/proposal`,
      query: { sellerCandidateId: candidate },
    });
    expect(response.status).toBe(200);
    const db = holder.db as FakeSupabase;
    expect(rpcCall(db, 'purchase_terms_proposal')[0]?.arg).toMatchObject({
      p_seller_candidate: candidate,
    });
  });

  it('refuses a malformed seller candidate instead of falling back to the caller', async () => {
    const response = await call({
      path: `customer-applications/${APP_ID}/purchase-terms/proposal`,
      query: { sellerCandidateId: 'not-a-uuid' },
    });
    expect(response.status).toBe(400);
  });

  it('surfaces an invalid seller as a forbidden, not a silent self-sale', async () => {
    install({
      rpcErrors: {
        purchase_terms_proposal: { code: '42501', message: 'SELLER_NOT_IN_YOUR_DOWNLINE' },
      },
    });
    const response = await call({
      path: `customer-applications/${APP_ID}/purchase-terms/proposal`,
      query: { sellerCandidateId: '99999999-9999-4999-8999-999999999999' },
    });
    expect(response.status).toBe(403);
  });

  it('requires authorization before any proposal is computed', async () => {
    const denied = await call({
      path: `customer-applications/${APP_ID}/purchase-terms/proposal`,
      token: 'forbidden-token',
    });
    expect(denied.status).toBe(403);
  });

  it('never returns a proposal the contract itself would reject', async () => {
    install({
      rpcs: [
        {
          fn: 'purchase_terms_proposal',
          // A browser-asserted price that does not match the frozen schedule.
          result: {
            ...proposal,
            terms: { ...proposalTerms, monthlyAmount: '1.00', installmentMonths: 4 },
          },
        },
      ],
    });
    const response = await call({
      path: `customer-applications/${APP_ID}/purchase-terms/proposal`,
    });
    expect(response.status).toBe(500);
  });
});

describe('purchase terms submission', () => {
  it('submits with the shown hash and returns the application', async () => {
    install({ rpcs: [{ fn: 'submit_purchase_application_once', result: APP_ID }] });
    const response = await call({
      path: `customer-applications/${APP_ID}/submit`,
      method: 'POST',
      body: { requestId, expectedProposalHash: HASH },
    });
    expect(response.status).toBe(200);
    const db = holder.db as FakeSupabase;
    const calls = rpcCall(db, 'submit_purchase_application_once');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arg).toMatchObject({ p_expected_hash: HASH, p_request_id: requestId });
  });

  it('rejects a stale proposal hash as a conflict', async () => {
    install({
      rpcErrors: {
        submit_purchase_application_once: {
          code: '55000',
          message: 'PURCHASE_PROPOSAL_CHANGED',
        },
      },
    });
    const response = await call({
      path: `customer-applications/${APP_ID}/submit`,
      method: 'POST',
      body: { requestId, expectedProposalHash: 'b'.repeat(64) },
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('rejects a browser-supplied price or commission', async () => {
    for (const extra of [
      { totalPrice: '1.00' },
      { expectedCommission: '9999.00' },
      { status: 'approved' },
      { reservationFee: '1.00' },
    ]) {
      install({ rpcs: [{ fn: 'submit_purchase_application_once', result: APP_ID }] });
      const response = await call({
        path: `customer-applications/${APP_ID}/submit`,
        method: 'POST',
        body: { requestId, expectedProposalHash: HASH, ...extra },
      });
      expect(response.status).toBe(400);
      expect((holder.db as FakeSupabase).calls.some((c) => c.op === 'rpc')).toBe(false);
    }
  });

  it('requires a request id, so a lost response can be retried safely', async () => {
    install();
    const response = await call({
      path: `customer-applications/${APP_ID}/submit`,
      method: 'POST',
      body: { expectedProposalHash: HASH },
    });
    expect(response.status).toBe(400);
  });

  it('replays the same request to the same RPC and returns the original result', async () => {
    install({ rpcs: [{ fn: 'submit_purchase_application_once', result: APP_ID }] });
    const body = { requestId, expectedProposalHash: HASH };
    const first = await call({
      path: `customer-applications/${APP_ID}/submit`,
      method: 'POST',
      body,
    });
    const replay = await call({
      path: `customer-applications/${APP_ID}/submit`,
      method: 'POST',
      body,
    });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    const rpcs = rpcCall(holder.db as FakeSupabase, 'submit_purchase_application_once');
    expect(rpcs).toHaveLength(2);
    expect(rpcs[0]?.arg).toEqual(rpcs[1]?.arg);
  });

  it('sends a changed payload on the same request id, so the database can conflict it', async () => {
    install({ rpcs: [{ fn: 'submit_purchase_application_once', result: APP_ID }] });
    await call({
      path: `customer-applications/${APP_ID}/submit`,
      method: 'POST',
      body: { requestId, expectedProposalHash: HASH },
    });
    install({
      rpcs: [{ fn: 'submit_purchase_application_once', result: APP_ID }],
      rpcErrors: { submit_purchase_application_once: { message: 'MUTATION_PAYLOAD_CONFLICT' } },
    });
    const changed = await call({
      path: `customer-applications/${APP_ID}/submit`,
      method: 'POST',
      body: { requestId, expectedProposalHash: 'c'.repeat(64) },
    });
    expect(changed.status).toBe(409);
  });

  it('refuses a non-draft application without capturing anything', async () => {
    install({
      rpcErrors: {
        submit_purchase_application_once: {
          code: '55000',
          message: 'INVALID_APPLICATION_TRANSITION',
        },
      },
    });
    const response = await call({
      path: `customer-applications/${APP_ID}/submit`,
      method: 'POST',
      body: { requestId, expectedProposalHash: HASH },
    });
    expect(response.status).toBe(409);
  });
});

describe('old approved application review', () => {
  const review = (extra: Record<string, unknown> = {}) => ({
    requestId,
    expectedProposalHash: HASH,
    reason: 'Historical commercial evidence missing; new offer confirmed today.',
    ...extra,
  });

  it('captures an explicitly new offer with a mandatory reason', async () => {
    const termsId = '77777777-7777-4777-8777-777777777777';
    install({ rpcs: [{ fn: 'review_application_purchase_terms_once', result: termsId }] });
    const response = await call({
      path: `customer-applications/${APP_ID}/purchase-terms/review`,
      method: 'POST',
      body: review(),
    });
    expect(response.status).toBe(200);
    const calls = rpcCall(holder.db as FakeSupabase, 'review_application_purchase_terms_once');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arg).toMatchObject({
      p_reason: 'Historical commercial evidence missing; new offer confirmed today.',
      p_expected_hash: HASH,
    });
  });

  it('requires a reason of real length', async () => {
    install();
    for (const reason of [undefined, 'ok', 'x'.repeat(501)]) {
      const response = await call({
        path: `customer-applications/${APP_ID}/purchase-terms/review`,
        method: 'POST',
        body: review(reason === undefined ? { reason: undefined } : { reason }),
      });
      expect(response.status).toBe(400);
    }
  });

  it('never accepts an arbitrary manual price', async () => {
    install();
    const response = await call({
      path: `customer-applications/${APP_ID}/purchase-terms/review`,
      method: 'POST',
      body: review({ totalPrice: '1.00', commissionBase: '1.00', expectedCommission: '1.00' }),
    });
    expect(response.status).toBe(400);
  });

  it('requires the reviewer grant', async () => {
    install();
    const response = await call({
      path: `customer-applications/${APP_ID}/purchase-terms/review`,
      method: 'POST',
      body: review(),
      token: 'no-update-token',
    });
    expect(response.status).toBe(403);
  });

  it('surfaces review-required state and a live reservation as conflicts', async () => {
    for (const code of ['PURCHASE_TERMS_REVIEW_REQUIRED', 'RESERVATION_ALREADY_EXISTS']) {
      install({
        rpcErrors: { review_application_purchase_terms_once: { code: '55000', message: code } },
      });
      const response = await call({
        path: `customer-applications/${APP_ID}/purchase-terms/review`,
        method: 'POST',
        body: review(),
      });
      expect(response.status).toBe(409);
    }
  });

  it('rejects a stale review hash', async () => {
    install({
      rpcErrors: {
        review_application_purchase_terms_once: {
          code: '55000',
          message: 'PURCHASE_PROPOSAL_CHANGED',
        },
      },
    });
    const response = await call({
      path: `customer-applications/${APP_ID}/purchase-terms/review`,
      method: 'POST',
      body: review({ expectedProposalHash: 'd'.repeat(64) }),
    });
    expect(response.status).toBe(409);
  });

  it('presents the old application as a newly confirmed offer, not as history', async () => {
    install({
      rpcs: [{ fn: 'purchase_terms_proposal', result: reviewProposal }],
    });
    const response = await call({
      path: `customer-applications/${APP_ID}/purchase-terms/proposal`,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ offerKind: 'newly_confirmed_offer' });
  });
});

describe('application decisions are atomic transitions', () => {
  it('approves through one RPC that also carries the audit', async () => {
    install({ rpcs: [{ fn: 'decide_purchase_application_once', result: APP_ID }] });
    const response = await call({
      path: `customer-applications/${APP_ID}/decision`,
      method: 'POST',
      body: { requestId, decision: 'approved' },
    });
    expect(response.status).toBe(200);
    const db = holder.db as FakeSupabase;
    expect(db.calls.some((c) => c.op === 'update' && c.table === 'customer_applications')).toBe(
      false,
    );
    expect(db.calls.some((c) => c.op === 'insert' && c.table === 'audit_events')).toBe(false);
    expect(rpcCall(db, 'decide_purchase_application_once')).toHaveLength(1);
  });

  it('reopens to draft through the same transition RPC', async () => {
    install({ rpcs: [{ fn: 'decide_purchase_application_once', result: APP_ID }] });
    const response = await call({
      path: `customer-applications/${APP_ID}/reopen`,
      method: 'POST',
      body: { requestId },
    });
    expect(response.status).toBe(200);
    expect(
      rpcCall(holder.db as FakeSupabase, 'decide_purchase_application_once')[0]?.arg,
    ).toMatchObject({ p_decision: 'draft' });
  });

  it('requires a request id for decisions and reopens', async () => {
    install();
    for (const path of [
      `customer-applications/${APP_ID}/decision`,
      `customer-applications/${APP_ID}/reopen`,
    ]) {
      const response = await call({ path, method: 'POST', body: {} });
      expect(response.status).toBe(400);
    }
  });

  it('refuses an approval that would leave the application without frozen terms', async () => {
    install({
      rpcErrors: {
        decide_purchase_application_once: {
          code: '55000',
          message: 'PURCHASE_TERMS_REVIEW_REQUIRED',
        },
      },
    });
    const response = await call({
      path: `customer-applications/${APP_ID}/decision`,
      method: 'POST',
      body: { requestId, decision: 'approved' },
    });
    expect(response.status).toBe(409);
  });

  it('refuses an invalid jump', async () => {
    install({
      rpcErrors: {
        decide_purchase_application_once: {
          code: '55000',
          message: 'INVALID_APPLICATION_TRANSITION',
        },
      },
    });
    const response = await call({
      path: `customer-applications/${APP_ID}/decision`,
      method: 'POST',
      body: { requestId, decision: 'approved' },
    });
    expect(response.status).toBe(409);
  });

  it('refuses an inactive or restricted actor before any row is read', async () => {
    install();
    const denied = await call({
      path: `customer-applications/${APP_ID}/decision`,
      method: 'POST',
      body: { requestId, decision: 'approved' },
      token: 'forbidden-token',
    });
    expect(denied.status).toBe(403);
    expect((holder.db as FakeSupabase).calls.some((c) => c.op === 'rpc')).toBe(false);
  });
});
