/**
 * AF Homes Phase 30 - reports, exports, and audit completion.
 *
 * Drives the REAL reports handler (real gates, real scope helpers, real
 * renderers, real CSV/XLSX/PDF writers) against focused fixtures. Phase 15
 * proved per-report scoping; Phase 29 proved snapshot attribution. This suite
 * completes the lifecycle: export consistency across all four formats,
 * formula-injection escaping, exact money everywhere, the 5000-row export
 * cap, snapshot immunity at report level, privacy exclusions, and the audit
 * center (pagination, filters, redaction, authorization, immutability).
 *
 * No second engine is built: every export renders the same scoped row matrix
 * as its on-screen report through `sendExport`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportResponseSchema } from '@jad/contracts';

import {
  CUSTOMER,
  PRODUCT,
  ROLE2,
  SALE,
  STAFF2,
  TOKEN,
  TOKEN2,
  moduleId,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { UUID } from '../_lib/testing/fixtures.js';
import { FakeSupabase, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const { default: handler } = await import('./reports.js');

const now = new Date();
const iso = (daysAgo: number) => new Date(now.valueOf() - daysAgo * 86400000).toISOString();

function tables(): Record<string, Record<string, unknown>[]> {
  return {
    customers: [
      ...phase2World({}).customers!,
      {
        id: 'aaaaaaaa-0000-4000-8000-0000000000f1',
        customer_number: 'CUS-000099',
        first_name: '=2+2',
        middle_name: null,
        last_name: '+cmd|/c calc',
        suffix: null,
        email: 'hostile@example.invalid',
        phone: '09180000099',
        government_id_type: 'passport',
        government_id_number: 'P-HOSTILE-1',
        status: 'prospect',
        created_by: STAFF2.salesManager,
        referred_by_staff_id: STAFF2.salesManager,
        created_at: iso(2),
        updated_at: iso(2),
      },
    ],
    card_sales: [
      {
        id: SALE.submitted,
        sale_number: 'SALE-000001',
        customer_id: CUSTOMER.prospect,
        plan_id: PRODUCT.gold,
        seller_type: 'staff',
        seller_staff_id: STAFF2.salesManager,
        seller_ost_id: null,
        cash_price_snapshot: '60000.00',
        minimum_down_payment_snapshot: '20000.00',
        yearly_points_snapshot: 60000,
        commission_rate_snapshot: '0.04',
        expected_commission_snapshot: '2400.00',
        status: 'submitted',
        submitted_at: iso(5),
        payment_verified_at: null,
        fully_paid_at: null,
        activated_at: null,
        created_at: iso(5),
        updated_at: iso(5),
      },
      {
        id: SALE.downPaid,
        sale_number: 'SALE-000002',
        customer_id: CUSTOMER.prospectTwo,
        plan_id: PRODUCT.silver,
        seller_type: 'staff',
        seller_staff_id: STAFF2.salesManager,
        seller_ost_id: null,
        cash_price_snapshot: '40000.00',
        minimum_down_payment_snapshot: '15000.00',
        yearly_points_snapshot: 40000,
        commission_rate_snapshot: '0.04',
        expected_commission_snapshot: '1600.00',
        status: 'payment_in_progress',
        submitted_at: iso(4),
        payment_verified_at: null,
        fully_paid_at: null,
        activated_at: null,
        created_at: iso(4),
        updated_at: iso(4),
      },
    ],
    payments: [
      { id: 'cc000000-0000-4000-8000-0000000000a1', sale_id: SALE.downPaid, customer_id: CUSTOMER.prospectTwo, amount: '0.10', payment_type: 'installment', method: 'cash', reference: 'TRF-1', status: 'verified', recorded_by: STAFF2.salesManager, verified_by: STAFF2.salesManager, recorded_at: iso(3), verified_at: iso(3), receipt_storage_path: 'private/afhomes-payment-receipts/r1.pdf', rejection_reason: null },
      { id: 'cc000000-0000-4000-8000-0000000000a2', sale_id: SALE.downPaid, customer_id: CUSTOMER.prospectTwo, amount: '0.20', payment_type: 'installment', method: 'cash', reference: 'TRF-2', status: 'verified', recorded_by: STAFF2.salesManager, verified_by: STAFF2.salesManager, recorded_at: iso(3), verified_at: iso(3), receipt_storage_path: null, rejection_reason: null },
      { id: 'cc000000-0000-4000-8000-0000000000a3', sale_id: SALE.downPaid, customer_id: CUSTOMER.prospectTwo, amount: '29999.70', payment_type: 'installment', method: 'bank_transfer', reference: 'TRF-3', status: 'verified', recorded_by: STAFF2.salesManager, verified_by: STAFF2.salesManager, recorded_at: iso(3), verified_at: iso(3), receipt_storage_path: null, rejection_reason: null },
      { id: 'cc000000-0000-4000-8000-0000000000a4', sale_id: SALE.submitted, customer_id: CUSTOMER.prospect, amount: '5000.00', payment_type: 'down_payment', method: 'cash', reference: 'TRF-4', status: 'recorded', recorded_by: STAFF2.salesManager, verified_by: null, recorded_at: iso(1), verified_at: null, receipt_storage_path: null, rejection_reason: null },
    ],
    commissions: [
      { id: 'ee000000-0000-4000-8000-0000000000a1', sale_id: SALE.submitted, beneficiary_type: 'staff', beneficiary_staff_id: STAFF2.salesManager, beneficiary_ost_id: null, amount: '2400.00', rate_snapshot: '0.04', basis_amount_snapshot: '60000.00', status: 'pending', created_at: iso(5) },
      { id: 'ee000000-0000-4000-8000-0000000000a2', sale_id: SALE.downPaid, beneficiary_type: 'staff', beneficiary_staff_id: STAFF2.salesManager, beneficiary_ost_id: null, amount: '1600.00', rate_snapshot: '0.04', basis_amount_snapshot: '40000.00', status: 'earned', qualified_at: iso(2), earned_at: iso(2), paid_at: null, created_at: iso(4) },
    ],
    memberships: [
      { id: 'dd000000-0000-4000-8000-0000000000a1', customer_id: CUSTOMER.prospectTwo, sale_id: SALE.downPaid, membership_number: 'MBS-000101', product_id: PRODUCT.silver, status: 'active', points_balance: 40000, yearly_points_allocated: 40000, activated_by: STAFF2.salesManager, activated_at: iso(2), expires_at: iso(-363), renewal_due_at: iso(-363), issued_at: iso(2) },
    ],
    redemptions: [
      { id: 'ff000000-0000-4000-8000-0000000000a1', redemption_number: 'RDM-000101', membership_id: 'dd000000-0000-4000-8000-0000000000a1', customer_id: CUSTOMER.prospectTwo, points_account_id: 'ffffffff-0000-4000-8000-000000000001', redemption_item_id: '33333333-0000-4000-8000-000000000001', item_code_snapshot: 'RICE-5KG', item_name_snapshot: 'Rice 5kg', points_cost_snapshot: 5000, quantity: 2, total_points: 10000, balance_before_snapshot: 40000, balance_after_snapshot: 30000, redeemed_by: STAFF2.hr, redeemed_by_name: 'HR Officer', status: 'completed', created_at: iso(1), completed_at: iso(1), voided_at: null, void_reason: null, idempotency_key: 'hr-30-1' },
    ],
    redemption_items: [
      { id: '33333333-0000-4000-8000-000000000001', code: 'RICE-5KG', name: 'Rice 5kg', points_cost: 5000, is_active: true },
    ],
    ost_applications: [
      { id: '44444444-0000-4000-8000-0000000000a1', sponsor_staff_id: STAFF2.salesManager, first_name: 'App', middle_name: null, last_name: 'One', email: 'app1@example.invalid', phone: '09180000011', status: 'submitted', submitted_at: iso(2), reviewed_at: null, reviewed_by: null, review_notes: null },
    ],
    card_sale_hierarchy_snapshots: [
      { sale_id: SALE.submitted, ancestor_staff_id: STAFF2.salesManager, ancestor_role: 'sales_manager', depth: 0 },
      { sale_id: SALE.downPaid, ancestor_staff_id: STAFF2.salesManager, ancestor_role: 'sales_manager', depth: 0 },
    ],
    audit_events: [
      { id: 1, actor_id: STAFF2.salesManager, action: 'APPLICATION_SUBMITTED', entity_type: 'card_sale', entity_id: SALE.submitted, before_data: null, after_data: { saleNumber: 'SALE-000001' }, reason: null, created_at: iso(5) },
      { id: 2, actor_id: STAFF2.salesManager, action: 'PAYMENT_RECORDED', entity_type: 'payment', entity_id: 'cc000000-0000-4000-8000-0000000000a4', before_data: null, after_data: { amount: '5000.00' }, reason: null, created_at: iso(4) },
      { id: 3, actor_id: UUID.adminStaff, action: 'COMMISSION_QUALIFIED', entity_type: 'commission', entity_id: 'ee000000-0000-4000-8000-0000000000a2', before_data: { status: 'final_qualification_pending' }, after_data: { status: 'earned', amount: '1600.00' }, reason: 'reviewed', created_at: iso(3) },
      { id: 4, actor_id: STAFF2.hr, action: 'REDEMPTION_COMPLETED', entity_type: 'redemption', entity_id: 'ff000000-0000-4000-8000-0000000000a1', before_data: null, after_data: { token: 'tok-secret-should-vanish', receipt_storage_path: 'private/x.pdf', government_id_number: 'P-1', qr_token: 'qr-secret', nested: { api_key: 'key-secret' } }, reason: null, created_at: iso(2) },
      { id: 5, actor_id: STAFF2.salesManager, action: 'PAYMENT_VERIFIED', entity_type: 'payment', entity_id: 'cc000000-0000-4000-8000-0000000000a1', before_data: { status: 'recorded' }, after_data: { status: 'verified' }, reason: null, created_at: iso(1) },
      { id: 6, actor_id: UUID.adminStaff, action: 'STAFF_INVITED', entity_type: 'staff_user', entity_id: STAFF2.ost, before_data: null, after_data: { email: 'ost@afhomes.test' }, reason: null, created_at: iso(0) },
    ],
  };
}

function install() {
  const db = new FakeSupabase({ tables: phase2World(tables() as never), tokens: phase2WorldTokens() });
  holder.db = db as unknown;
  const real = db as FakeSupabase;
  // Production-baseline grants the shared fixtures predate or narrow down.
  for (const role of [ROLE2.viceDirector, ROLE2.seniorSalesManager, ROLE2.salesManager]) {
    for (const key of ['sales.card_sales', 'network.commissions', 'network.genealogy']) {
      real.rows('role_permissions').push({ role_id: role, module_id: moduleId(key), can_view: true, can_create: false, can_update: false, can_delete: false });
    }
  }
  for (const key of ['network.commissions', 'network.genealogy']) {
    real.rows('role_permissions').push({ role_id: ROLE2.ost, module_id: moduleId(key), can_view: true, can_create: false, can_update: false, can_delete: false });
  }
  real.rows('role_permissions').push({ role_id: ROLE2.employee, module_id: moduleId('operations.redemption'), can_view: true, can_create: false, can_update: false, can_delete: false });
  real.rows('role_permissions').push({ role_id: ROLE2.admin, module_id: moduleId('network.genealogy'), can_view: true, can_create: false, can_update: false, can_delete: false });
  return real;
}

beforeEach(() => {
  install();
});

type State = { status: number; body: unknown };

async function get(path: string, token?: string, query: Record<string, string> = {}) {
  const { res, state } = makeRes();
  await handler(
    { method: 'GET', query: { familyPath: path, ...query }, headers: token ? { authorization: `Bearer ${token}` } : {} } as never,
    res as never,
  );
  return state;
}

const parsed = (state: State) => reportResponseSchema.parse(state.body);
const csvText = (state: State) => Buffer.from((state.body as { content: string }).content, 'base64').toString('utf8');
const xlsxText = (state: State) => Buffer.from((state.body as { content: string }).content, 'base64').toString('latin1');
const pdfText = (state: State) => Buffer.from((state.body as { content: string }).content, 'base64').toString('latin1');
const rowCount = (xml: string) => (xml.match(/<row r="/g) ?? []).length;

/* ================================================================== */
/* Scopes and permission matrix                                        */
/* ================================================================== */

describe('Phase 30 report scopes and permission matrix', () => {
  it('1. Super Admin reads every report globally', async () => {
    for (const report of ['sales', 'payments', 'commissions', 'genealogy', 'plans'] as const) {
      const state = await get(report, TOKEN.superAdmin);
      expect(state.status, report).toBe(200);
      expect(parsed(state).scope.kind).toBe('global');
    }
  });

  it('2. Finance reads payments but not the team genealogy', async () => {
    expect((await get('payments', TOKEN2.finance)).status).toBe(200);
    expect((await get('genealogy', TOKEN2.finance)).status).toBe(403);
  });

  it('3/4/5. sellers read their frozen attribution; siblings stay out', async () => {
    const sm = parsed(await get('sales', TOKEN2.salesManager));
    expect(sm.meta.total).toBe(2);
    const vd = parsed(await get('sales', TOKEN2.viceDirector));
    // VD holds no snapshot attribution in this fixture: scoped empty, not denied.
    expect(vd.meta.total).toBe(0);
  });

  it('6. OST reads its own sales and commissions only', async () => {
    // The OST fixture seller owns no fixture sale: empty scope, never an error.
    expect((await get('sales', TOKEN2.ost)).status).toBe(200);
    expect(parsed(await get('sales', TOKEN2.ost)).meta.total).toBe(0);
    expect((await get('commissions', TOKEN2.ost)).status).toBe(200);
  });

  it('7. employees read redemptions, nothing financial', async () => {
    expect((await get('redemptions', TOKEN2.hr)).status).toBe(200);
    expect((await get('sales', TOKEN2.hr)).status).toBe(403);
    expect((await get('payments', TOKEN2.hr)).status).toBe(403);
  });

  it('8. customers and strangers never reach staff reports', async () => {
    expect((await get('sales')).status).toBe(401);
    expect((await get('sales', 'tok-unknown')).status).toBe(401);
    expect((await get('audit')).status).toBe(401);
  });

  it('33/34. audit opens for granted admins, nobody else', async () => {
    expect((await get('audit', TOKEN.admin)).status).toBe(200);
    expect((await get('audit', TOKEN2.finance)).status).toBe(403);
    expect((await get('audit', TOKEN2.salesManager)).status).toBe(403);
    expect((await get('audit', TOKEN2.hr)).status).toBe(403);
  });
});

/* ================================================================== */
/* Filters narrow only                                                 */
/* ================================================================== */

describe('Phase 30 report filters', () => {
  it('9/10/11/12/13. date, status, seller, plan, and search filters apply server-side', async () => {
    const windowed = parsed(await get('sales', TOKEN.superAdmin, { from: iso(5.5), to: iso(4.5) }));
    expect(windowed.meta.total).toBe(1);
    expect((windowed.data[0] as { saleNumber: string }).saleNumber).toBe('SALE-000001');
    const byStatus = parsed(await get('payments', TOKEN.superAdmin, { status: 'verified' }));
    expect(byStatus.meta.total).toBe(3);
    const bySeller = parsed(await get('sales', TOKEN.superAdmin, { seller: STAFF2.salesManager }));
    expect(bySeller.meta.total).toBe(2);
    const byPlan = parsed(await get('sales', TOKEN.superAdmin, { planId: PRODUCT.gold }));
    expect(byPlan.meta.total).toBe(1);
    const searched = parsed(await get('customers', TOKEN.superAdmin, { search: 'hostile@example.invalid' }));
    expect(searched.meta.total).toBe(1);
  });

  it('14. an unrelated seller filter yields empty, never someone else rows', async () => {
    const state = parsed(await get('sales', TOKEN.superAdmin, { seller: STAFF2.ost }));
    expect(state.meta.total).toBe(0);
    expect((await get('sales', TOKEN.superAdmin, { from: 'not-a-date' })).status).toBe(400);
  });
});

/* ================================================================== */
/* Snapshot integrity                                                  */
/* ================================================================== */

describe('Phase 30 historical snapshot integrity', () => {
  it('15/16. frozen prices survive a live plan repricing', async () => {
    const db = holder.db as FakeSupabase;
    const before = parsed(await get('sales', TOKEN.superAdmin));
    db.rows('card_plans').find((r) => r.id === PRODUCT.gold)!.cash_price = '99999.99';
    const after = parsed(await get('sales', TOKEN.superAdmin));
    // generatedAt moves by definition; everything record-shaped must not.
    const { generatedAt: _a, ...afterRest } = after as Record<string, unknown>;
    const { generatedAt: _b, ...beforeRest } = before as unknown as Record<string, unknown>;
    expect(afterRest).toEqual(beforeRest);
  });

  it('17. a genealogy move keeps historical sales attribution', async () => {
    const db = holder.db as FakeSupabase;
    const before = parsed(await get('sales', TOKEN2.salesManager));
    const edge = db.rows('referral_relationships').find((r) => r.subject_staff_id === STAFF2.salesManager)!;
    edge.is_active = false;
    const after = parsed(await get('sales', TOKEN2.salesManager));
    expect(after.meta.total).toBe(before.meta.total);
    expect(after.summary).toEqual(before.summary);
  });

  it('18. a catalog rename keeps redemption history byte-identical', async () => {
    const db = holder.db as FakeSupabase;
    const before = parsed(await get('redemptions', TOKEN.admin));
    db.rows('redemption_items').push({ id: '33333333-0000-4000-8000-000000000001', code: 'RICE-5KG', name: 'Rice Premium 5kg', points_cost: 9999, is_active: true });
    const after = parsed(await get('redemptions', TOKEN.admin));
    expect(after.data).toEqual(before.data);
    expect(after.summary).toEqual(before.summary);
  });

  it('19. commission beneficiary and amounts survive a staff rename', async () => {
    const db = holder.db as FakeSupabase;
    const before = parsed(await get('commissions', TOKEN.superAdmin));
    db.rows('staff_users').find((r) => r.id === STAFF2.salesManager)!.full_name = 'Renamed Manager';
    const after = parsed(await get('commissions', TOKEN.superAdmin));
    // Attribution (sale, basis, rate, amount) is frozen; only the display
    // name follows the live staff record, by design.
    expect(after.data).toHaveLength(before.data.length);
    for (const row of after.data as Record<string, unknown>[]) {
      expect(row).toMatchObject({ basePrice: expect.any(String), rate: expect.any(String), amount: expect.any(String) });
    }
    expect(
      (after.data as Record<string, unknown>[]).map((r) => [r.saleNumber, r.amount, r.status]).sort(),
    ).toEqual(
      (before.data as Record<string, unknown>[]).map((r) => [r.saleNumber, r.amount, r.status]).sort(),
    );
  });
});

/* ================================================================== */
/* Exports: consistency, caps, escaping, exact money                   */
/* ================================================================== */

describe('Phase 30 exports', () => {
  it('20/21/22/23. CSV, XLSX, and PDF describe the same filtered records', async () => {
    const json = parsed(await get('payments', TOKEN.superAdmin, { status: 'verified' }));
    const ids = (json.data as { saleNumber: string; reference: string }[]).map((r) => r.reference).sort();
    for (const format of ['csv', 'xlsx', 'pdf'] as const) {
      const state = await get('payments', TOKEN.superAdmin, { status: 'verified', format });
      expect(state.status, format).toBe(200);
      expect((state.body as { rowCount: number }).rowCount).toBe(3);
    }
    const csv = csvText(await get('payments', TOKEN.superAdmin, { status: 'verified', format: 'csv' }));
    for (const ref of ids) expect(csv).toContain(ref);
    const xlsx = xlsxText(await get('payments', TOKEN.superAdmin, { status: 'verified', format: 'xlsx' }));
    expect(rowCount(xlsx)).toBe(4);
    expect(xlsx).toContain('Sale number');
    expect(xlsx).toContain('TRF-1');
    const pdf = pdfText(await get('payments', TOKEN.superAdmin, { status: 'verified', format: 'pdf' }));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('AF Homes - payments report');
    for (const ref of ids) expect(pdf).toContain(ref);
  });

  it('24. an unauthorized role cannot export either', async () => {
    expect((await get('payments', TOKEN2.hr, { format: 'csv' })).status).toBe(403);
    expect((await get('sales', TOKEN2.hr, { format: 'pdf' })).status).toBe(403);
  });

  it('refuses exports above the row cap instead of truncating silently', async () => {
    const db = holder.db as FakeSupabase;
    for (let i = 0; i < 5001; i += 1) {
      db.rows('payments').push({ id: `cc-cap-${i}`, sale_id: SALE.submitted, amount: '1.00', status: 'verified', recorded_at: iso(1), verified_at: iso(1) });
    }
    const state = await get('payments', TOKEN.superAdmin, { format: 'csv' });
    expect(state.status).toBe(400);
    expect(JSON.stringify(state.body)).toContain('5000-row export cap');
  });

  it('25. escapes spreadsheet formula prefixes without touching amounts', async () => {
    // NOTE: the in-memory fake evaluates `or()` ilike filters as full-value
    // matches while PostgREST evaluates them as substrings, so search terms
    // here are complete field values (as in every pre-existing spec). The
    // escaping behavior under test is identical either way.
    const csv = csvText(await get('customers', TOKEN.superAdmin, { search: 'hostile@example.invalid', format: 'csv' }));
    // The display name joins first+last into ONE cell, so only its leading
    // `=` is escaped; the mid-cell `+` correctly stays verbatim.
    expect(csv).toContain("'=2+2 +cmd|/c calc");
    const xlsx = xlsxText(await get('customers', TOKEN.superAdmin, { search: 'hostile@example.invalid', format: 'xlsx' }));
    expect(xlsx).toContain('=2+2');
  });

  it('26/27/28/48. exact money in every format: 0.10 + 0.20 + 29999.70', async () => {
    // Row-level cells keep their exact-decimal strings in CSV...
    const csv = csvText(await get('payments', TOKEN.superAdmin, { status: 'verified', format: 'csv' }));
    expect(csv).toContain('0.10');
    expect(csv).toContain('0.20');
    expect(csv).toContain('29999.70');
    expect(csv).not.toContain('30000.01');
    // ...XLSX money cells carry the same values numerically with a two-decimal
    // display style (s="2"), so 0.1 renders as 0.10, never 0.10000000000000001.
    const xlsx = xlsxText(await get('payments', TOKEN.superAdmin, { status: 'verified', format: 'xlsx' }));
    expect(xlsx).toContain('<v>0.1</v>');
    expect(xlsx).toContain('<v>0.2</v>');
    expect(xlsx).toContain('<v>29999.7</v>');
    expect(xlsx).toContain('s="2"');
    // ...and the aggregation that sums them is exactly 30000.00 in PDF text
    // and in the JSON summary alike: no binary float ever participates.
    const pdf = pdfText(await get('payments', TOKEN.superAdmin, { status: 'verified', format: 'pdf' }));
    expect(pdf).toContain('Verified total: 30000.00');
    const summary = parsed(await get('payments', TOKEN.superAdmin));
    expect(summary.summary).toMatchObject({ verifiedTotal: '30000.00' });
  });
});

/* ================================================================== */
/* Export privacy                                                      */
/* ================================================================== */

describe('Phase 30 export privacy', () => {
  it('29/30/31/32. exports carry no hashes, paths, secrets, or raw IDs', async () => {
    for (const [report, format] of [['payments', 'csv'], ['customers', 'xlsx'], ['commissions', 'pdf'], ['memberships', 'csv']] as const) {
      const state = await get(report, TOKEN.superAdmin, { format });
      expect(state.status, `${report}/${format}`).toBe(200);
      const text = format === 'pdf' ? pdfText(state) : format === 'xlsx' ? xlsxText(state) : csvText(state);
      for (const forbidden of ['receipt_storage_path', 'private/afhomes', 'government_id', 'P-HOSTILE-1', 'qr_token', 'fallback_code', 'service_role', 'beneficiary_staff_id']) {
        expect(text, `${report}/${format}:${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

/* ================================================================== */
/* Audit center                                                        */
/* ================================================================== */

describe('Phase 30 audit center', () => {
  it('35/36/37/38. paginates and filters by actor, action, entity, and date', async () => {
    const page = await get('audit', TOKEN.admin, { limit: '2', offset: '0' });
    expect(page.status).toBe(200);
    const body = page.body as { data: unknown[]; meta: { total: number } };
    expect(body.meta.total).toBe(6);
    expect(body.data).toHaveLength(2);
    const second = await get('audit', TOKEN.admin, { limit: '2', offset: '2' });
    expect((second.body as { data: unknown[] }).data).toHaveLength(2);

    const byActor = await get('audit', TOKEN.admin, { actor: STAFF2.salesManager });
    expect((byActor.body as { meta: { total: number } }).meta.total).toBe(3);
    const byAction = await get('audit', TOKEN.admin, { action: 'COMMISSION_QUALIFIED' });
    expect((byAction.body as { meta: { total: number } }).meta.total).toBe(1);
    const byEntity = await get('audit', TOKEN.admin, { entityType: 'payment', entityId: 'cc000000-0000-4000-8000-0000000000a4' });
    expect((byEntity.body as { meta: { total: number } }).meta.total).toBe(1);
    const byDate = await get('audit', TOKEN.admin, { from: iso(2), to: iso(0) });
    expect((byDate.body as { meta: { total: number } }).meta.total).toBe(3);
  });

  it('39. redacts sensitive metadata while keeping the summary readable', async () => {
    const state = await get('audit', TOKEN.admin, { action: 'REDEMPTION_COMPLETED' });
    expect(state.status).toBe(200);
    const text = JSON.stringify(state.body);
    for (const secret of ['tok-secret-should-vanish', 'private/x.pdf', 'P-1', 'qr-secret', 'key-secret']) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain('REDEMPTION_COMPLETED');
  });

  it('exports audit as CSV with the same redaction', async () => {
    const state = await get('audit', TOKEN.admin, { format: 'csv' });
    expect(state.status).toBe(200);
    const text = csvText(state);
    expect(text).toContain('Metadata (redacted)');
    expect(text).not.toContain('tok-secret-should-vanish');
  });

  it('40. audit history is read-only for browser roles by schema and grant', async () => {
    const sql = readFileSync(resolve(process.cwd(), '../supabase/migrations/20260926023325_afhomes_phase1_foundation.sql'), 'utf8');
    expect(sql).toContain('audit_events');
    // The bulk revoke covers audit_events; the only policy is SELECT.
    expect(sql).toMatch(/revoke all on public\.\%I from anon, authenticated/);
    expect(sql).toMatch(/create policy audit_events_read on public\.audit_events[\s\S]{0,200}?for select to authenticated/);
    expect(sql).toMatch(/grant select on public\.identity_documents, public\.audit_events to authenticated/);
    expect(sql).not.toMatch(/create policy audit_events_write|audit_events_insert|audit_events_update|audit_events_delete/i);
  });
});
