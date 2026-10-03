/**
 * Phase 15 Reports and Audit Center.
 *
 * Every test drives the REAL handler (real permission resolver, real scope
 * helpers, real renderers) against the in-memory Supabase fake. Fixture roles
 * are extended to the production baseline where the shared Phase 2 fixtures
 * are narrower (VD/SSM/SM/OST/finance report grants), and each extension is
 * labelled so a drift from `role-baseline.ts` is visible here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportExportSchema, reportResponseSchema } from '@jad/contracts';

import {
  CUSTOMER,
  MEMBERSHIP,
  PRODUCT,
  ROLE2,
  SALE,
  STAFF2,
  TOKEN2,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { TOKEN, UUID, moduleId } from '../_lib/testing/fixtures.js';
import { FakeSupabase, makeRes } from '../_lib/testing/supabase-fake.js';
import type { FakeRow } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));
const { default: handler } = await import('./reports.js');
const { routeRequest, selectHandler } = await import('../_lib/router.js');

const OST_SALE = 'bbbbbbbb-0000-4000-8000-000000000009';

function grant(
  roleId: string,
  key: string,
  crud: [boolean, boolean, boolean, boolean] = [true, false, false, false],
) {
  (holder.db as FakeSupabase).rows('role_permissions').push({
    role_id: roleId,
    module_id: moduleId(key),
    can_view: crud[0],
    can_create: crud[1],
    can_update: crud[2],
    can_delete: crud[3],
  });
}

function install() {
  const now = new Date().toISOString();
  const tables = phase2World({
    card_sales: [
      ...phase2World({}).card_sales!,
      {
        id: OST_SALE,
        sale_number: 'SALE-000009',
        customer_id: CUSTOMER.prospectTwo,
        plan_id: PRODUCT.bronze,
        seller_type: 'ost',
        seller_staff_id: null,
        seller_ost_id: STAFF2.ost,
        cash_price: '30000.00',
        cash_price_snapshot: '30000.00',
        minimum_down_payment_snapshot: '10000.00',
        yearly_points_snapshot: 25000,
        commission_rate_snapshot: '0.04',
        expected_commission_snapshot: '1200.00',
        status: 'payment_in_progress',
        submitted_at: now,
        payment_verified_at: null,
        fully_paid_at: null,
        activated_at: null,
        cancelled_at: null,
        cancellation_reason: null,
        spot_cash_started_at: null,
        spot_cash_deadline: null,
        referral_relationship_id: null,
        created_by: STAFF2.salesManager,
        balance_due_at: now,
        created_at: now,
        updated_at: now,
      },
    ],
    card_sale_hierarchy_snapshots: [
      {
        sale_id: SALE.downPaid,
        ancestor_staff_id: STAFF2.salesManager,
        ancestor_role: 'sales_manager',
        depth: 1,
      },
      {
        sale_id: SALE.downPaid,
        ancestor_staff_id: STAFF2.seniorSalesManager,
        ancestor_role: 'senior_sales_manager',
        depth: 2,
      },
      {
        sale_id: SALE.downPaid,
        ancestor_staff_id: STAFF2.viceDirector,
        ancestor_role: 'vice_director',
        depth: 3,
      },
      {
        sale_id: OST_SALE,
        ancestor_staff_id: STAFF2.salesManager,
        ancestor_role: 'sales_manager',
        depth: 1,
      },
      {
        sale_id: OST_SALE,
        ancestor_staff_id: STAFF2.seniorSalesManager,
        ancestor_role: 'senior_sales_manager',
        depth: 2,
      },
      {
        sale_id: OST_SALE,
        ancestor_staff_id: STAFF2.viceDirector,
        ancestor_role: 'vice_director',
        depth: 3,
      },
    ],
    redemptions: [
      {
        id: '22222222-0000-4000-8000-000000000001',
        redemption_number: 'RDM-000001',
        membership_id: MEMBERSHIP.active,
        customer_id: CUSTOMER.active,
        points_account_id: 'ffffffff-0000-4000-8000-000000000001',
        redemption_item_id: '33333333-0000-4000-8000-000000000001',
        item_code_snapshot: 'RICE-5KG',
        item_name_snapshot: 'Rice 5kg',
        points_cost_snapshot: 5000,
        quantity: 2,
        total_points: 10000,
        balance_before_snapshot: 60000,
        balance_after_snapshot: 50000,
        redeemed_by: STAFF2.hr,
        redeemed_by_name: 'HR Officer',
        status: 'completed',
        created_at: now,
        completed_at: now,
        voided_at: null,
        void_reason: null,
        idempotency_key: 'hr-txn-1',
      },
      {
        id: '22222222-0000-4000-8000-000000000002',
        redemption_number: 'RDM-000002',
        membership_id: MEMBERSHIP.active,
        customer_id: CUSTOMER.active,
        points_account_id: 'ffffffff-0000-4000-8000-000000000001',
        redemption_item_id: '33333333-0000-4000-8000-000000000001',
        item_code_snapshot: 'RICE-5KG',
        item_name_snapshot: 'Rice 5kg',
        points_cost_snapshot: 5000,
        quantity: 1,
        total_points: 5000,
        balance_before_snapshot: 50000,
        balance_after_snapshot: 45000,
        redeemed_by: UUID.adminStaff,
        redeemed_by_name: 'Ops Admin',
        status: 'completed',
        created_at: now,
        completed_at: now,
        voided_at: null,
        void_reason: null,
        idempotency_key: 'admin-txn-1',
      },
    ],
    ost_applications: [
      {
        id: '44444444-0000-4000-8000-000000000001',
        sponsor_staff_id: STAFF2.salesManager,
        first_name: 'Applicant',
        middle_name: null,
        last_name: 'One',
        email: 'applicant1@example.com',
        phone: '09180000001',
        status: 'submitted',
        submitted_at: now,
        reviewed_at: null,
        reviewed_by: null,
        review_notes: null,
      },
      {
        id: '44444444-0000-4000-8000-000000000002',
        sponsor_staff_id: STAFF2.viceDirector,
        first_name: 'Applicant',
        middle_name: null,
        last_name: 'Two',
        email: 'applicant2@example.com',
        phone: '09180000002',
        status: 'under_review',
        submitted_at: now,
        reviewed_at: null,
        reviewed_by: null,
        review_notes: null,
      },
    ],
    ost_members: [
      {
        id: STAFF2.ost,
        application_id: '44444444-0000-4000-8000-000000000001',
        sponsor_staff_id: STAFF2.salesManager,
        ost_number: 'OST-000001',
        full_name: 'OST Seller',
        email: 'ost@afhomes.test',
        phone: '09180000003',
        status: 'active',
        approved_at: now,
        approved_by: UUID.adminStaff,
      },
    ],
    audit_events: [
      {
        id: 1,
        actor_id: UUID.adminStaff,
        action: 'APPLICATION_SUBMITTED',
        entity_type: 'card_sale',
        entity_id: SALE.submitted,
        before_data: null,
        after_data: { saleNumber: 'SALE-000001' },
        reason: null,
        created_at: now,
      },
      {
        id: 2,
        actor_id: UUID.superAdminStaff,
        action: 'COMMISSION_QUALIFIED',
        entity_type: 'commission',
        entity_id: '99990000-0000-4000-8000-000000000002',
        before_data: { status: 'final_qualification_pending' },
        after_data: {
          status: 'earned',
          qr_token_hash: 'a'.repeat(64),
          onboarding_token: 'raw-once',
        },
        reason: 'manual qualification',
        created_at: now,
      },
    ],
  });
  holder.db = new FakeSupabase({ tables, tokens: phase2WorldTokens() });
  const db = holder.db as FakeSupabase;
  // Production-baseline grants the shared fixtures predate or narrow down.
  for (const role of [ROLE2.viceDirector, ROLE2.seniorSalesManager, ROLE2.salesManager]) {
    for (const key of [
      'sales.card_sales',
      'sales.customers',
      'sales.card_plans',
      'finance.payment_verification',
      'finance.card_activation',
      'finance.points',
      'network.commissions',
      'network.genealogy',
    ]) {
      db.rows('role_permissions').push({
        role_id: role,
        module_id: moduleId(key),
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      });
    }
  }
  for (const key of ['network.ost_registrations', 'network.ost_members']) {
    grant(ROLE2.viceDirector, key);
    grant(ROLE2.salesManager, key);
  }
  for (const key of [
    'sales.card_sales',
    'sales.customers',
    'sales.card_plans',
    'network.commissions',
    'network.genealogy',
  ]) {
    grant(ROLE2.ost, key);
  }
  // Production finance also reads the sales surface (fixtures grant only
  // finance.* + customers + redemption).
  grant(ROLE2.finance, 'sales.card_sales');
  grant(ROLE2.finance, 'sales.card_plans');
  grant(ROLE2.finance, 'sales.customers');
  // Production employee alone may spend points (fixtures grant dashboard only).
  grant(ROLE2.employee, 'operations.redemption', [true, true, false, false]);
  // Fixture admin lacks the network reads the audit/genealogy/ost reports need.
  grant(ROLE2.admin, 'network.genealogy');
  grant(ROLE2.admin, 'network.ost_registrations');
  grant(ROLE2.admin, 'network.ost_members');
  grant(ROLE2.admin, 'operations.redemption');
  grant(ROLE2.admin, 'finance.points');
  return db;
}

async function get(path: string, token?: string, query: Record<string, string> = {}) {
  const { res, state } = makeRes();
  await handler(
    {
      method: 'GET',
      query: { familyPath: path, ...query },
      headers: token ? { authorization: `Bearer ${token}` } : {},
    } as never,
    res as never,
  );
  return state;
}

beforeEach(() => install());

describe('sales report', () => {
  it('excludes imported history from operational sales and payment totals', async () => {
    const db = holder.db as FakeSupabase;
    const sale = db.rows('card_sales').find((row) => row.id === SALE.downPaid)!;
    sale.origin = 'legacy_import';
    const sales = reportResponseSchema.parse((await get('sales', TOKEN.superAdmin)).body);
    expect(sales.data.some((row) => row.saleNumber === sale.sale_number)).toBe(false);
    const payments = reportResponseSchema.parse((await get('payments', TOKEN.superAdmin)).body);
    expect(payments.data.some((row) => row.saleNumber === sale.sale_number)).toBe(false);
  });
  it('gives Super Admin the global frozen-snapshot report with exact totals', async () => {
    const state = await get('', TOKEN.superAdmin, {});
    // Root catalog is separate; the sales report lives at its own sub-path.
    expect(state.status).toBe(200);
    const sales = await get('sales', TOKEN.superAdmin);
    expect(sales.status).toBe(200);
    const parsed = reportResponseSchema.parse(sales.body);
    expect(parsed.scope.kind).toBe('global');
    expect(parsed.meta.total).toBe(6);
    expect(parsed.summary).toMatchObject({
      sales: 6,
      grossFrozenValue: '250000.00',
      verifiedPaid: '105000.00',
      remaining: '145000.00',
    });
    const row = parsed.data.find((r) => r.saleNumber === 'SALE-000002') as Record<string, unknown>;
    expect(row).toMatchObject({
      frozenPrice: '40000.00',
      requiredDown: '15000.00',
      yearlyPointsSnapshot: 40000,
      verifiedPaid: '15000.00',
      remaining: '25000.00',
    });
  });

  it('scopes VD, SSM, and SM to their frozen snapshot attribution', async () => {
    for (const token of [TOKEN2.viceDirector, TOKEN2.seniorSalesManager, TOKEN2.salesManager]) {
      const state = await get('sales', token);
      expect(state.status, token).toBe(200);
      const parsed = reportResponseSchema.parse(state.body);
      expect(parsed.scope.kind, token).toBe('team');
      expect(parsed.meta.total, token).toBe(2);
      expect(parsed.data.map((r) => (r as { saleNumber: string }).saleNumber).sort()).toEqual([
        'SALE-000002',
        'SALE-000009',
      ]);
    }
  });

  it('excludes unrelated-team sales even when the viewer holds the grant', async () => {
    const state = await get('sales', TOKEN2.salesManager);
    const parsed = reportResponseSchema.parse(state.body);
    const numbers = parsed.data.map((r) => (r as { saleNumber: string }).saleNumber);
    expect(numbers).not.toContain('SALE-000001');
    expect(numbers).not.toContain('SALE-000003');
  });

  it('keeps frozen attribution when the current genealogy changes', async () => {
    const db = holder.db as FakeSupabase;
    for (const rel of db.rows('referral_relationships')) rel.is_active = false;
    const state = await get('sales', TOKEN2.salesManager);
    expect(reportResponseSchema.parse(state.body).meta.total).toBe(2);
  });

  it('limits OST callers to the sales they sold', async () => {
    const state = await get('sales', TOKEN2.ost);
    expect(state.status).toBe(200);
    const parsed = reportResponseSchema.parse(state.body);
    expect(parsed.scope.kind).toBe('self');
    expect(parsed.meta.total).toBe(1);
    expect((parsed.data[0] as { saleNumber: string }).saleNumber).toBe('SALE-000009');
  });

  it('denies callers without the grant and without a session', async () => {
    expect((await get('sales', TOKEN.unassigned)).status).toBe(403);
    expect((await get('sales')).status).toBe(401);
  });
});

describe('payments report', () => {
  it('counts only verified money toward received totals', async () => {
    const state = await get('payments', TOKEN2.finance);
    expect(state.status).toBe(200);
    const parsed = reportResponseSchema.parse(state.body);
    expect(parsed.summary).toMatchObject({
      payments: 5,
      verifiedTotal: '105000.00',
      pendingTotal: '5000.00',
      rejectedTotal: '9999.99',
    });
  });

  it('never exports the private receipt storage path', async () => {
    const state = await get('payments', TOKEN2.finance);
    expect(JSON.stringify(state.body)).not.toContain('receipt_storage_path');
  });
});

describe('customer report', () => {
  it('excludes raw government IDs, auth IDs, and document fields', async () => {
    const state = await get('customers', TOKEN.superAdmin);
    expect(state.status).toBe(200);
    const text = JSON.stringify(state.body);
    expect(text).not.toContain('government_id_number');
    expect(text).not.toContain('governmentIdNumber');
    expect(text).not.toContain('auth_user_id');
    expect(text).not.toContain('0011-2233-4455');
    expect(text).toContain('juan@example.com');
  });

  it('masks contact fields for team-scoped viewers', async () => {
    const state = await get('customers', TOKEN2.salesManager);
    expect(state.status).toBe(200);
    const parsed = reportResponseSchema.parse(state.body);
    // SM scope reaches only Maria Santos (both attributed sales name her).
    expect(parsed.meta.total).toBe(1);
    const text = JSON.stringify(state.body);
    expect(text).toContain('m***@example.com');
    expect(text).toContain('***0102');
    expect(text).not.toContain('maria@example.com');
    expect(text).not.toContain('09185550102');
  });
});

describe('membership, commission, and points reports', () => {
  it('never exports QR tokens, fallback codes, or their hashes', async () => {
    const state = await get('memberships', TOKEN2.finance);
    expect(state.status).toBe(200);
    const text = JSON.stringify(state.body);
    expect(text).not.toMatch(/qr_token/i);
    expect(text).not.toMatch(/fallback_code/i);
    expect(text).not.toContain('hash-of-qr-token');
  });

  it('groups commissions by lifecycle state without projecting payouts', async () => {
    const state = await get('commissions', TOKEN.superAdmin);
    expect(state.status).toBe(200);
    const parsed = reportResponseSchema.parse(state.body);
    expect((parsed.summary.byStatus as Record<string, number>).pending).toBe(1);
    expect((parsed.summary.byStatus as Record<string, number>).final_qualification_pending).toBe(1);
    expect(JSON.stringify(parsed)).not.toMatch(/payout|override|probability/i);
  });

  it('reports points as loyalty units, never money', async () => {
    const state = await get('points', TOKEN2.finance);
    expect(state.status).toBe(200);
    const parsed = reportResponseSchema.parse(state.body);
    expect(parsed.summary).toMatchObject({ entries: 1, netPoints: 60000 });
    const row = parsed.data[0] as Record<string, unknown>;
    expect(typeof row.amount).toBe('number');
    expect(JSON.stringify(parsed)).not.toContain('₱');
  });
});

describe('redemption report', () => {
  it('limits employees to their own handled redemptions', async () => {
    const state = await get('redemptions', TOKEN2.hr);
    expect(state.status).toBe(200);
    const parsed = reportResponseSchema.parse(state.body);
    expect(parsed.scope.kind).toBe('redemption');
    expect(parsed.meta.total).toBe(1);
    expect((parsed.data[0] as { redemptionNumber: string }).redemptionNumber).toBe('RDM-000001');
    expect(parsed.summary).toMatchObject({ redemptions: 1, pointsSpent: 10000 });
  });

  it('shows admins the whole operation with point snapshots', async () => {
    const state = await get('redemptions', TOKEN.admin);
    expect(reportResponseSchema.parse(state.body).meta.total).toBe(2);
  });
});

describe('genealogy and OST reports', () => {
  it('reports current structure with frozen historical sales per seller', async () => {
    const state = await get('genealogy', TOKEN.admin);
    expect(state.status).toBe(200);
    const parsed = reportResponseSchema.parse(state.body);
    expect(parsed.meta.total).toBe(4);
    const vd = parsed.data.find((r) => (r as { role: string }).role === 'vice_director') as Record<
      string,
      unknown
    >;
    expect(vd).toMatchObject({
      historicalSales: 2,
      historicalValue: '70000.00',
      directDownline: 1,
    });
  });

  it('limits OST viewers to themselves plus their upline', async () => {
    const state = await get('genealogy', TOKEN2.ost);
    expect(reportResponseSchema.parse(state.body).meta.total).toBe(4);
  });

  it('scopes OST applications and members to the sponsor', async () => {
    const apps = reportResponseSchema.parse((await get('ost', TOKEN2.salesManager)).body);
    expect(apps.meta.total).toBe(1);
    const members = reportResponseSchema.parse(
      (await get('ost', TOKEN2.salesManager, { kind: 'members' })).body,
    );
    expect(members.meta.total).toBe(1);
    // The OST member sees their own member row.
    const own = reportResponseSchema.parse(
      (await get('ost', TOKEN2.ost, { kind: 'members' })).body,
    );
    expect(own.meta.total).toBe(1);
    expect(JSON.stringify(apps)).not.toMatch(/code_hash|codeHint/i);
  });

  it('rejects an unknown OST kind instead of guessing', async () => {
    expect((await get('ost', TOKEN.superAdmin, { kind: 'refunds' })).status).toBe(400);
  });
});

describe('plans report', () => {
  it('lists reference plans with in-scope sales counts', async () => {
    const state = await get('plans', TOKEN.superAdmin);
    expect(state.status).toBe(200);
    const parsed = reportResponseSchema.parse(state.body);
    expect(parsed.meta.total).toBe(4);
    const bronze = parsed.data.find((r) => (r as { code: string }).code === 'BRONZE') as Record<
      string,
      unknown
    >;
    expect(bronze).toMatchObject({ scopedSales: 3, scopedValue: '90000.00' });
  });
});

describe('filters, pagination, and empty sets', () => {
  it('paginates without changing the total', async () => {
    const first = reportResponseSchema.parse(
      (await get('sales', TOKEN.superAdmin, { limit: '2', offset: '0' })).body,
    );
    const second = reportResponseSchema.parse(
      (await get('sales', TOKEN.superAdmin, { limit: '2', offset: '2' })).body,
    );
    expect(first.meta).toMatchObject({ total: 6, limit: 2, offset: 0 });
    expect(first.data).toHaveLength(2);
    expect(second.data).toHaveLength(2);
    expect((first.data[0] as { saleNumber: string }).saleNumber).not.toBe(
      (second.data[0] as { saleNumber: string }).saleNumber,
    );
  });

  it('applies an explicit date window server-side', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const state = await get('sales', TOKEN.superAdmin, { from: yesterday });
    const parsed = reportResponseSchema.parse(state.body);
    expect(parsed.meta.total).toBe(1);
    expect((parsed.data[0] as { saleNumber: string }).saleNumber).toBe('SALE-000009');
  });

  it('rejects an unparseable date instead of ignoring it', async () => {
    expect((await get('sales', TOKEN.superAdmin, { from: 'not-a-date' })).status).toBe(400);
  });

  it('answers an empty report with zeros, not nulls', async () => {
    const state = await get('sales', TOKEN.superAdmin, { status: 'no-such-status' });
    const parsed = reportResponseSchema.parse(state.body);
    expect(parsed.meta.total).toBe(0);
    expect(parsed.data).toEqual([]);
    expect(parsed.summary).toMatchObject({ sales: 0, grossFrozenValue: '0.00' });
  });

  it('exports an empty CSV as headers only', async () => {
    const state = await get('sales', TOKEN.superAdmin, { status: 'no-such-status', format: 'csv' });
    const envelope = reportExportSchema.parse(state.body);
    const csv = Buffer.from(envelope.content, 'base64').toString('utf8');
    expect(csv).toContain('Sale number');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});

describe('exports from the scoped query', () => {
  it('renders CSV with stable headers from the same rows as JSON', async () => {
    const json = reportResponseSchema.parse(
      (await get('sales', TOKEN.superAdmin, { limit: '2' })).body,
    );
    const state = await get('sales', TOKEN.superAdmin, { format: 'csv' });
    const envelope = reportExportSchema.parse(state.body);
    expect(envelope).toMatchObject({
      report: 'sales',
      format: 'csv',
      mime: 'text/csv',
      truncated: false,
    });
    const csv = Buffer.from(envelope.content, 'base64').toString('utf8');
    expect(csv).toContain('Sale number,Date,Customer');
    expect(csv).toContain(String((json.data[0] as { saleNumber: string }).saleNumber));
  });

  it('protects user-controlled text against formula injection in CSV', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('payments').push({
      id: 'cccccccc-0000-4000-8000-000000000099',
      sale_id: SALE.downPaid,
      customer_id: CUSTOMER.prospectTwo,
      amount: '1.00',
      payment_type: 'installment',
      method: 'cash',
      reference: '=HYPERLINK("https://evil.example")',
      notes: null,
      receipt_storage_path: null,
      status: 'recorded',
      rejection_reason: null,
      recorded_by: UUID.adminStaff,
      verified_by: null,
      recorded_at: new Date().toISOString(),
      verified_at: null,
    });
    const state = await get('payments', TOKEN2.finance, { format: 'csv', status: 'recorded' });
    const csv = Buffer.from(reportExportSchema.parse(state.body).content, 'base64').toString(
      'utf8',
    );
    expect(csv).toContain(`"'=HYPERLINK`);
  });

  it('renders a real XLSX package and a real PDF document', async () => {
    const xlsx = reportExportSchema.parse(
      (await get('sales', TOKEN.superAdmin, { format: 'xlsx' })).body,
    );
    expect(xlsx.mime).toContain('spreadsheetml');
    const zip = Buffer.from(xlsx.content, 'base64');
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip.toString('utf8')).toContain('Sale number');

    const pdf = reportExportSchema.parse(
      (await get('memberships', TOKEN.superAdmin, { format: 'pdf' })).body,
    );
    const doc = Buffer.from(pdf.content, 'base64').toString('latin1');
    expect(doc.startsWith('%PDF')).toBe(true);
    expect(doc).toContain('AF Homes - memberships report');
  });

  it('rejects an unknown format instead of defaulting', async () => {
    expect((await get('sales', TOKEN.superAdmin, { format: 'exe' })).status).toBe(400);
  });

  it('404s an unknown report name', async () => {
    expect((await get('refunds', TOKEN.superAdmin)).status).toBe(404);
  });
});

describe('audit center', () => {
  it('opens for Super Admin and explicitly granted Admin, nobody else', async () => {
    expect((await get('audit', TOKEN.superAdmin)).status).toBe(200);
    expect((await get('audit', TOKEN.admin)).status).toBe(200);
    expect((await get('audit', TOKEN2.finance)).status).toBe(403);
    expect((await get('audit', TOKEN2.salesManager)).status).toBe(403);
    expect((await get('audit')).status).toBe(401);
  });

  it('filters by action, actor, and entity type', async () => {
    const byAction = await get('audit', TOKEN.superAdmin, { action: 'COMMISSION_QUALIFIED' });
    expect((byAction.body as { meta: { total: number } }).meta.total).toBe(1);
    const byActor = await get('audit', TOKEN.superAdmin, { actor: UUID.superAdminStaff });
    expect((byActor.body as { meta: { total: number } }).meta.total).toBe(1);
    const byEntity = await get('audit', TOKEN.superAdmin, { entityType: 'card_sale' });
    expect((byEntity.body as { meta: { total: number } }).meta.total).toBe(1);
  });

  it('redacts sensitive metadata keys in list and export', async () => {
    const state = await get('audit', TOKEN.superAdmin, { action: 'COMMISSION_QUALIFIED' });
    const text = JSON.stringify(state.body);
    expect(text).toContain('[redacted]');
    expect(text).not.toContain('a'.repeat(64));
    expect(text).not.toContain('raw-once');
    const csv = reportExportSchema.parse(
      (await get('audit', TOKEN.superAdmin, { format: 'csv' })).body,
    );
    expect(Buffer.from(csv.content, 'base64').toString('utf8')).toContain('[redacted]');
  });
});

describe('safety and wiring', () => {
  it('returns a safe 500 that never echoes driver detail', async () => {
    holder.db = new FakeSupabase({
      tables: phase2World({}),
      tokens: phase2WorldTokens(),
      errors: { card_sales: { message: 'secret database detail' } },
    });
    const state = await get('sales', TOKEN.superAdmin);
    expect(state.status).toBe(500);
    expect(JSON.stringify(state.body)).not.toContain('secret database detail');
  });

  it('dispatches through the real router with the deployed route key', async () => {
    expect(selectHandler('/api/v1/reports/sales', {})?.routeKey).toBe('reports/sales');
    expect(selectHandler('/api/v1/reports/audit', {})?.routeKey).toBe('reports/audit');
    const { res, state } = makeRes();
    const handled = await routeRequest(
      {
        method: 'GET',
        url: '/api/v1/reports/sales?limit=1',
        query: {},
        headers: { authorization: `Bearer ${TOKEN.superAdmin}` },
      } as never,
      res as never,
    );
    expect(handled).toBe(true);
    expect(state.status).toBe(200);
  });

  it('ships no migration: Phase 15 reads only columns earlier phases own', async () => {
    const { readdirSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const files = readdirSync(resolve(process.cwd(), '../supabase/migrations'));
    expect(files.filter((file) => /phase15/i.test(file))).toEqual([]);
  });
});

describe('outstanding report search', () => {
  it.each(['payments', 'commissions', 'genealogy', 'ost', 'points', 'plans'])(
    '%s returns a controlled empty filtered set',
    async (path) => {
      const state = await get(path, TOKEN.superAdmin, { search: '__NO_SUCH_RECORD__' });
      expect(state.status).toBe(200);
      const result = reportResponseSchema.parse(state.body);
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    },
  );
});

describe('safe projected fields and pagination', () => {
  const fields = [
    ['payments', 'customer'],
    ['payments', 'saleNumber'],
    ['payments', 'reference'],
    ['payments', 'status'],
    ['commissions', 'beneficiary'],
    ['commissions', 'saleNumber'],
    ['commissions', 'status'],
    ['genealogy', 'seller'],
    ['genealogy', 'role'],
    ['ost', 'applicant'],
    ['ost', 'sponsor'],
    ['points', 'customer'],
    ['points', 'membershipNumber'],
    ['points', 'entryType'],
    ['points', 'reference'],
    ['plans', 'name'],
    ['plans', 'code'],
  ];
  it.each(fields)('%s searches %s literally and ignores case', async (path, field) => {
    const baseline = reportResponseSchema.parse((await get(path, TOKEN.superAdmin)).body);
    const value = baseline.data
      .map((row) => row[field])
      .find((value) => typeof value === 'string' && value.length > 0);
    expect(typeof value).toBe('string');
    if (typeof value !== 'string') throw new Error('Missing searchable fixture');
    const upper = reportResponseSchema.parse(
      (await get(path, TOKEN.superAdmin, { search: value.toUpperCase() })).body,
    );
    const lower = reportResponseSchema.parse(
      (await get(path, TOKEN.superAdmin, { search: value.toLowerCase() })).body,
    );
    expect(upper.data.length).toBeGreaterThan(0);
    expect(lower.data).toEqual(upper.data);
  });
  it.each(['payments', 'commissions', 'genealogy', 'ost', 'points', 'plans'])(
    '%s preserves filtered totals across pages',
    async (path) => {
      const baseline = reportResponseSchema.parse((await get(path, TOKEN.superAdmin)).body);
      const field =
        path === 'payments'
          ? 'customer'
          : path === 'commissions'
            ? 'beneficiary'
            : path === 'genealogy'
              ? 'seller'
              : path === 'ost'
                ? 'applicant'
                : path === 'points'
                  ? 'customer'
                  : 'name';
      const search = String(baseline.data[0]?.[field] ?? '');
      const full = reportResponseSchema.parse((await get(path, TOKEN.superAdmin, { search })).body);
      const page = reportResponseSchema.parse(
        (await get(path, TOKEN.superAdmin, { search, limit: '1', offset: '1' })).body,
      );
      expect(page.meta.total).toBe(full.meta.total);
      expect(page.data).toEqual(full.data.slice(1, 2));
    },
  );
  it.each(['payments', 'commissions', 'genealogy', 'ost', 'points', 'plans'])(
    '%s cannot turn an unauthenticated search into access',
    async (path) => {
      expect((await get(path, undefined, { search: 'a' })).status).toBe(401);
    },
  );
});

describe('combined outstanding search filters', () => {
  it.each(['payments', 'commissions'])('%s retains status and date constraints', async (path) => {
    const all = reportResponseSchema.parse((await get(path, TOKEN.superAdmin)).body);
    const row = all.data[0];
    const field = path === 'payments' ? 'customer' : 'beneficiary';
    const search = String(row[field]);
    const status = String(row.status);
    const filtered = reportResponseSchema.parse(
      (await get(path, TOKEN.superAdmin, { search, status })).body,
    );
    expect(filtered.data.length).toBeGreaterThan(0);
    expect(filtered.data.every((item) => item.status === status)).toBe(true);
    const empty = reportResponseSchema.parse(
      (await get(path, TOKEN.superAdmin, { search, from: '2099-01-01', to: '2099-01-02' })).body,
    );
    expect(empty.meta.total).toBe(0);
    expect(empty.data).toEqual([]);
  });
  it('does not discover a foreign customer through payment search', async () => {
    const result = reportResponseSchema.parse(
      (await get('payments', TOKEN2.salesManager, { search: 'Juan' })).body,
    );
    expect(result.meta.total).toBe(0);
  });
  it('retains points entry type while matching member identity', async () => {
    const all = reportResponseSchema.parse((await get('points', TOKEN.superAdmin)).body);
    const row = all.data[0];
    const result = reportResponseSchema.parse(
      (
        await get('points', TOKEN.superAdmin, {
          search: String(row.customer),
          status: String(row.entryType),
        })
      ).body,
    );
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((item) => item.entryType === row.entryType)).toBe(true);
  });
  it.each(['BRONZE', 'SILVER', 'GOLD'])('finds %s plans with active filtering', async (search) => {
    const result = reportResponseSchema.parse(
      (await get('plans', TOKEN.superAdmin, { search, status: 'active' })).body,
    );
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((row) => row.isActive === true)).toBe(true);
  });
});

describe('empty UUID-backed Payments filters', () => {
  const absent = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  it.each<Record<string, string>>([
    { planId: absent },
    { seller: absent },
    { planId: absent, seller: absent },
    { planId: absent, search: 'Juan' },
  ])('returns the ordinary zero report for %j without reading payments', async (query) => {
    (holder.db as FakeSupabase).errors.payments = {
      code: '22P02',
      message: 'must not query payments',
    };
    const result = await get('payments', TOKEN.superAdmin, query);
    expect(result.status).toBe(200);
    const report = reportResponseSchema.parse(result.body);
    expect(report.data).toEqual([]);
    expect(report.meta.total).toBe(0);
    expect(report.summary).toEqual({
      payments: 0,
      verifiedTotal: '0.00',
      pendingTotal: '0.00',
      rejectedTotal: '0.00',
    });
  });
  it.each(['planId', 'seller'])('still finds an existing %s', async (field) => {
    const sale = (holder.db as FakeSupabase)
      .rows('card_sales')
      .find((row) => row.id === SALE.downPaid)!;
    const result = await get('payments', TOKEN.superAdmin, {
      [field]: String(sale[field === 'planId' ? 'plan_id' : 'seller_staff_id']),
    });
    expect(result.status).toBe(200);
    expect(reportResponseSchema.parse(result.body).data.length).toBeGreaterThan(0);
  });
});

describe('genealogy snapshot batch ordering', () => {
  it('reads every unique snapshot pair repeatedly across 500-row boundaries', async () => {
    const db = holder.db as FakeSupabase;
    const snapshots = Array.from({ length: 1203 }, (_, n) => ({
      sale_id: 'aaaaaaaa-0000-4000-8000-' + String(Math.floor(n / 3)).padStart(12, '0'),
      ancestor_staff_id: [STAFF2.salesManager, STAFF2.seniorSalesManager, STAFF2.viceDirector][
        n % 3
      ],
    }));
    db.rows('card_sale_hierarchy_snapshots').splice(0, Infinity, ...snapshots.reverse());
    const original = db.from.bind(db);
    const orders: string[] = [];
    const offsets: number[] = [];
    const pairs: string[][] = [[], []];
    let pass = 0;
    vi.spyOn(db, 'from').mockImplementation((table) => {
      const query = original(table);
      if (table === 'card_sale_hierarchy_snapshots') {
        const order = query.order.bind(query);
        vi.spyOn(query, 'order').mockImplementation((...args) => {
          orders.push(args[0]);
          return order(...args);
        });
        const range = query.range.bind(query);
        vi.spyOn(query, 'range').mockImplementation((...args) => {
          offsets.push(args[0]);
          return range(...args);
        });
        const then = query.then.bind(query);
        vi.spyOn(query, 'then').mockImplementation((onFulfilled, onRejected) =>
          then((result) => {
            for (const row of result.data ?? [])
              pairs[pass].push(String(row.sale_id) + '/' + String(row.ancestor_staff_id));
            return onFulfilled ? onFulfilled(result) : result;
          }, onRejected),
        );
      }
      return query;
    });
    expect((await get('genealogy', TOKEN.superAdmin)).status).toBe(200);
    pass = 1;
    expect((await get('genealogy', TOKEN.superAdmin)).status).toBe(200);
    expect(orders).toEqual(['sale_id', 'ancestor_staff_id', 'sale_id', 'ancestor_staff_id']);
    expect(offsets).toEqual([0, 500, 1000, 0, 500, 1000]);
    expect(pairs[0]).toHaveLength(1203);
    expect(new Set(pairs[0]).size).toBe(1203);
    expect(new Set(pairs[0].slice(0, 1000)).size).toBe(1000);
    expect(new Set(pairs[0])).toEqual(
      new Set(snapshots.map((row) => row.sale_id + '/' + row.ancestor_staff_id)),
    );
    expect(pairs[1]).toEqual(pairs[0]);
  });
});
