/**
 * Employee personal service history (Who / What / When).
 *
 * Drives the REAL reports handler and the REAL redemptions handler against
 * the in-memory Supabase fake with two employee accounts:
 *
 *   Employee A (tok-hr)  serves Customer 1 (Pedro Reyes, MBS-000001, Gold)
 *   Employee B (tok-hr-2) serves Customer 2 (Maria Santos, MBS-000002, Silver)
 *
 * Pins the ownership rule (server derives the employee from the session),
 * the report columns, the summary cards, the filters, the CSV/XLSX exports,
 * the empty-state 200, and the absence of sensitive customer fields.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportExportSchema, reportResponseSchema } from '@afhomes/contracts';

import {
  CUSTOMER,
  LINKS,
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
import { FakeSupabase, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));
const { default: reportsHandler } = await import('./reports.js');
const { default: redemptionsHandler } = await import('./redemptions.js');

const EMP2_ID = '10101010-0000-4000-8000-000000000007';
const EMP2_TOKEN = 'tok-hr-2';
const MEMBERSHIP_TWO = 'dddddddd-0000-4000-8000-000000000002';
const ITEM_ID = '33333333-0000-4000-8000-000000000001';

const now = new Date().toISOString();

function install() {
  const tables = phase2World({
    memberships: [
      ...phase2World({}).memberships!,
      {
        id: MEMBERSHIP_TWO,
        customer_id: CUSTOMER.prospectTwo,
        sale_id: SALE.downPaid,
        membership_number: 'MBS-000002',
        product_id: PRODUCT.silver,
        sale_status_at_activation: 'payment_verified',
        fallback_code_hash: 'hash-of-afh-abcd-9999',
        qr_token_hash: 'hash-of-qr-token-two',
        status: 'active',
        points_balance: 40000,
        yearly_points_allocated: 40000,
        activated_by: STAFF2.salesManager,
        activated_at: now,
        expires_at: '2027-10-02T00:00:00.000Z',
        renewal_due_at: '2027-10-02T00:00:00.000Z',
        issued_at: now,
        created_at: now,
      },
    ],
    redemption_items: [
      {
        id: ITEM_ID,
        code: 'TEPPANYAKI',
        name: 'Japanese Teppanyaki',
        description: 'Dinner for two',
        category: 'dining',
        points_cost: 2000,
        is_active: true,
        sort_order: 10,
        created_at: now,
        updated_at: now,
      },
    ],
    redemptions: [
      {
        id: '22222222-0000-4000-8000-0000000000a1',
        redemption_number: 'RDM-000101',
        membership_id: 'dddddddd-0000-4000-8000-000000000001',
        customer_id: CUSTOMER.active,
        points_account_id: 'ffffffff-0000-4000-8000-000000000001',
        redemption_item_id: ITEM_ID,
        item_code_snapshot: 'TEPPANYAKI',
        item_name_snapshot: 'Japanese Teppanyaki',
        points_cost_snapshot: 2000,
        quantity: 1,
        total_points: 2000,
        balance_before_snapshot: 5000,
        balance_after_snapshot: 3000,
        redeemed_by: STAFF2.hr,
        redeemed_by_name: 'HR Officer',
        status: 'completed',
        created_at: now,
        completed_at: now,
        voided_at: null,
        void_reason: null,
        idempotency_key: 'emp-a-txn-1',
      },
      {
        id: '22222222-0000-4000-8000-0000000000a2',
        redemption_number: 'RDM-000102',
        membership_id: MEMBERSHIP_TWO,
        customer_id: CUSTOMER.prospectTwo,
        points_account_id: 'ffffffff-0000-4000-8000-000000000001',
        redemption_item_id: ITEM_ID,
        item_code_snapshot: 'TEPPANYAKI',
        item_name_snapshot: 'Japanese Teppanyaki',
        points_cost_snapshot: 2000,
        quantity: 2,
        total_points: 4000,
        balance_before_snapshot: 40000,
        balance_after_snapshot: 36000,
        redeemed_by: EMP2_ID,
        redeemed_by_name: 'Second Officer',
        status: 'completed',
        created_at: now,
        completed_at: now,
        voided_at: null,
        void_reason: null,
        idempotency_key: 'emp-b-txn-1',
      },
    ],
  });
  const tokens = phase2WorldTokens();
  tokens[EMP2_TOKEN] = {
    id: EMP2_ID,
    email: 'second@afhomes.test',
    email_confirmed_at: '2026-09-01T00:00:00.000Z',
  };
  const db = new FakeSupabase({
    tables,
    tokens,
    links: [
      ...LINKS,
      { child: 'redemptions', parent: 'customers', fk: 'customer_id' },
      { child: 'redemptions', parent: 'memberships', fk: 'membership_id' },
    ],
  });
  holder.db = db as unknown;
  const real = db as FakeSupabase;
  // Second employee account on the production employee role.
  real.rows('staff_users').push({
    id: EMP2_ID,
    email: 'second@afhomes.test',
    full_name: 'Second Officer',
    department_id: null,
    status: 'active',
    invited_at: now,
    activated_at: now,
    created_at: now,
    updated_at: now,
  });
  real.rows('staff_role_assignments').push({
    staff_id: EMP2_ID,
    role_id: ROLE2.employee,
    assigned_at: now,
  });
  // Production employee grant: redemption point-of-sale (view + create).
  real.rows('role_permissions').push({
    role_id: ROLE2.employee,
    module_id: moduleId('operations.redemption'),
    can_view: true,
    can_create: true,
    can_update: false,
    can_delete: false,
  });
  return real;
}

async function getReport(path: string, token?: string, query: Record<string, string> = {}) {
  const { res, state } = makeRes();
  await reportsHandler(
    {
      method: 'GET',
      query: { familyPath: path, ...query },
      headers: token ? { authorization: `Bearer ${token}` } : {},
    } as never,
    res as never,
  );
  return state;
}

async function getHistory(token?: string, query: Record<string, string> = {}) {
  const { res, state } = makeRes();
  await redemptionsHandler(
    {
      method: 'GET',
      query: { familyPath: '', ...query },
      headers: token ? { authorization: `Bearer ${token}` } : {},
    } as never,
    res as never,
  );
  return state;
}

async function getDetail(id: string, token?: string) {
  const { res, state } = makeRes();
  await redemptionsHandler(
    {
      method: 'GET',
      query: { familyPath: id },
      headers: token ? { authorization: `Bearer ${token}` } : {},
    } as never,
    res as never,
  );
  return state;
}

beforeEach(() => install());

describe('employee personal service history', () => {
  it.each(['memberships', 'sales', 'payments'])(
    'denies employee %s reports even with a broad module grant',
    async (report) => {
      const db = install();
      for (const key of [
        'finance.card_activation',
        'sales.card_sales',
        'finance.payment_verification',
      ])
        db.rows('role_permissions').push({
          role_id: ROLE2.employee,
          module_id: moduleId(key),
          can_view: true,
          can_create: false,
          can_update: false,
          can_delete: false,
        });
      const state = await getReport(report, EMP2_TOKEN, { format: 'csv' });
      expect(state.status).toBe(403);
    },
  );
  it('1. returns 200 for the employee report endpoint', async () => {
    const state = await getReport('redemptions', TOKEN2.hr);
    expect(state.status).toBe(200);
    reportResponseSchema.parse(state.body);
  });

  it('2. answers an employee with no rows as an empty 200, never a 500', async () => {
    const state = await getReport('redemptions', TOKEN2.hr, { status: 'voided' });
    expect(state.status).toBe(200);
    const parsed = reportResponseSchema.parse(state.body);
    expect(parsed.data).toEqual([]);
    expect(parsed.meta.total).toBe(0);
    expect(parsed.summary).toMatchObject({
      redemptions: 0,
      pointsSpent: 0,
      customersServed: 0,
      completedTransactions: 0,
      pointsRedeemed: 0,
    });
  });

  it('3. employee A sees only the redemption they handled', async () => {
    const parsed = reportResponseSchema.parse((await getReport('redemptions', TOKEN2.hr)).body);
    expect(parsed.scope.kind).toBe('redemption');
    expect(parsed.meta.total).toBe(1);
    expect((parsed.data[0] as { referenceNumber: string }).referenceNumber).toBe('RDM-000101');
  });

  it('4. employee A cannot see employee B history, even with a seller override', async () => {
    const direct = reportResponseSchema.parse((await getReport('redemptions', TOKEN2.hr)).body);
    expect(JSON.stringify(direct)).not.toContain('RDM-000102');
    // A forged ?seller= for the other employee must not escape the own scope.
    const forged = reportResponseSchema.parse(
      (await getReport('redemptions', TOKEN2.hr, { seller: EMP2_ID })).body,
    );
    expect(forged.meta.total).toBe(1);
    expect(JSON.stringify(forged)).not.toContain('RDM-000102');
    const other = reportResponseSchema.parse((await getReport('redemptions', EMP2_TOKEN)).body);
    expect(other.meta.total).toBe(1);
    expect((other.data[0] as { referenceNumber: string }).referenceNumber).toBe('RDM-000102');
  });

  it('5-10. carries the correct who/what/when/points/status', async () => {
    const parsed = reportResponseSchema.parse((await getReport('redemptions', TOKEN2.hr)).body);
    const row = parsed.data[0] as Record<string, unknown>;
    expect(row.customer).toBe('Pedro Reyes');
    expect(row.membershipNumber).toBe('MBS-000001');
    expect(row.tier).toBe('Gold');
    expect(row.serviceItem).toBe('Japanese Teppanyaki');
    expect(row.transactionType).toBe('redemption');
    expect(row.pointsUsed).toBe(2000);
    expect(row.quantity).toBe(1);
    expect(row.status).toBe('completed');
    expect(typeof row.date).toBe('string');
    expect(row.referenceNumber).toBe('RDM-000101');
    expect(row.balanceBefore).toBe(5000);
    expect(row.balanceAfter).toBe(3000);
    expect(row.servedBy).toBe('HR Officer');
  });

  it('11. filters by date window server-side', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const empty = reportResponseSchema.parse(
      (await getReport('redemptions', TOKEN2.hr, { from: tomorrow })).body,
    );
    expect(empty.meta.total).toBe(0);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const full = reportResponseSchema.parse(
      (await getReport('redemptions', TOKEN2.hr, { from: yesterday })).body,
    );
    expect(full.meta.total).toBe(1);
  });

  it('12-13. searches by customer name and membership number', async () => {
    const byCustomer = reportResponseSchema.parse(
      (await getReport('redemptions', TOKEN2.hr, { search: 'pedro' })).body,
    );
    expect(byCustomer.meta.total).toBe(1);
    // Casing never matters: lower, upper and mixed case all find the member.
    for (const term of ['PEDRO', 'Pedro', 'pEdRo', 'TEPPANYAKI', 'Teppanyaki']) {
      const found = reportResponseSchema.parse(
        (await getReport('redemptions', TOKEN2.hr, { search: term })).body,
      );
      expect(found.meta.total, term).toBe(1);
    }
    const byMembership = reportResponseSchema.parse(
      (await getReport('redemptions', TOKEN2.hr, { search: 'MBS-000001' })).body,
    );
    expect(byMembership.meta.total).toBe(1);
    const byReference = reportResponseSchema.parse(
      (await getReport('redemptions', TOKEN2.hr, { search: 'RDM-000101' })).body,
    );
    expect(byReference.meta.total).toBe(1);
    const byItem = reportResponseSchema.parse(
      (await getReport('redemptions', TOKEN2.hr, { search: 'teppanyaki' })).body,
    );
    expect(byItem.meta.total).toBe(1);
    // Searching for the OTHER employee's customer finds nothing in this scope.
    const miss = reportResponseSchema.parse(
      (await getReport('redemptions', TOKEN2.hr, { search: 'maria' })).body,
    );
    expect(miss.meta.total).toBe(0);
    expect(miss.data).toEqual([]);
  });

  it('14. filters by transaction type and status', async () => {
    const typed = reportResponseSchema.parse(
      (await getReport('redemptions', TOKEN2.hr, { transactionType: 'redemption' })).body,
    );
    expect(typed.meta.total).toBe(1);
    const other = await getReport('redemptions', TOKEN2.hr, { transactionType: 'refund' });
    expect(other.status).toBe(200);
    expect(reportResponseSchema.parse(other.body).meta.total).toBe(0);
    const byStatus = reportResponseSchema.parse(
      (await getReport('redemptions', TOKEN2.hr, { status: 'completed' })).body,
    );
    expect(byStatus.meta.total).toBe(1);
  });

  it('summarises the personal service history for the cards', async () => {
    const parsed = reportResponseSchema.parse((await getReport('redemptions', TOKEN2.hr)).body);
    expect(parsed.summary).toMatchObject({
      redemptions: 1,
      pointsSpent: 2000,
      customersServed: 1,
      completedTransactions: 1,
      pointsRedeemed: 2000,
      todayTransactions: 1,
      monthTransactions: 1,
    });
  });

  it('15-16. exports the scoped report as CSV and XLSX', async () => {
    const csv = await getReport('redemptions', TOKEN2.hr, { format: 'csv' });
    expect(csv.status).toBe(200);
    const envelope = reportExportSchema.parse(csv.body);
    expect(envelope).toMatchObject({ report: 'redemptions', format: 'csv', truncated: false });
    const text = Buffer.from(envelope.content, 'base64').toString('utf8');
    expect(text).toContain('Reference number');
    expect(text).toContain('RDM-000101');
    expect(text).not.toContain('RDM-000102');
    const xlsx = await getReport('redemptions', TOKEN2.hr, { format: 'xlsx' });
    expect(xlsx.status).toBe(200);
    const xlsxEnvelope = reportExportSchema.parse(xlsx.body);
    expect(xlsxEnvelope.mime).toContain('spreadsheetml');
    const zip = Buffer.from(xlsxEnvelope.content, 'base64');
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
  });

  it('17. denies callers without a staff session', async () => {
    expect((await getReport('redemptions')).status).toBe(401);
    expect((await getReport('redemptions', 'tok-unknown')).status).toBe(401);
  });

  it('18. denies OST callers without an explicit redemption grant', async () => {
    expect((await getReport('redemptions', TOKEN2.ost)).status).toBe(403);
  });

  it('19. permits admin oversight across employees and per-employee inspection', async () => {
    const all = reportResponseSchema.parse((await getReport('redemptions', TOKEN.admin)).body);
    expect(all.scope.kind).toBe('global');
    expect(all.meta.total).toBe(2);
    const one = reportResponseSchema.parse(
      (await getReport('redemptions', TOKEN.admin, { seller: STAFF2.hr })).body,
    );
    expect(one.meta.total).toBe(1);
    expect((one.data[0] as { referenceNumber: string }).referenceNumber).toBe('RDM-000101');
  });

  it('20. exposes no sensitive customer fields', async () => {
    const text = JSON.stringify((await getReport('redemptions', TOKEN.admin)).body);
    expect(text).not.toContain('government_id_number');
    expect(text).not.toContain('0011-2233-4455');
    expect(text).not.toContain('qr_token');
    expect(text).not.toContain('fallback_code');
    expect(text).not.toContain('hash-of-qr-token');
    expect(text).not.toContain('receipt_storage_path');
    expect(text).not.toContain('auth_user_id');
    expect(text).toContain('Pedro Reyes');
    expect(text).toContain('MBS-000001');
  });
});

describe('redemption history ownership (Step 15)', () => {
  it('scopes GET /redemptions to the rows each employee handled', async () => {
    const a = await getHistory(TOKEN2.hr);
    expect(a.status).toBe(200);
    const rowsA = (a.body as { data: { redemptionNumber: string }[] }).data;
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]!.redemptionNumber).toBe('RDM-000101');
    const b = await getHistory(EMP2_TOKEN);
    expect(b.status).toBe(200);
    const rowsB = (b.body as { data: { redemptionNumber: string }[] }).data;
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]!.redemptionNumber).toBe('RDM-000102');
  });

  it('lets admin read the whole history while an employee detail read of another row 404s', async () => {
    const all = await getHistory(TOKEN.admin);
    expect(all.status).toBe(200);
    expect((all.body as { data: unknown[] }).data).toHaveLength(2);
    const own = await getDetail('22222222-0000-4000-8000-0000000000a1', TOKEN2.hr);
    expect(own.status).toBe(200);
    const foreign = await getDetail('22222222-0000-4000-8000-0000000000a2', TOKEN2.hr);
    expect(foreign.status).toBe(404);
  });
});
