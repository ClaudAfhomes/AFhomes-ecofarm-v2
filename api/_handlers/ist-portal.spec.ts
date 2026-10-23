import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  phase2World,
  phase2WorldTokens,
  STAFF2,
  TOKEN2,
  ROLE2,
  moduleId,
  SALE,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const { default: handler } = await import('./ist-portal.js');

async function call(
  token: string = TOKEN2.salesManager,
  query: Record<string, string | undefined> = {},
  method = 'GET',
) {
  const { res, state } = makeRes();
  await handler(
    {
      method,
      headers: { authorization: `Bearer ${token}` },
      query: { familyPath: '', from: '2026-10-01', to: '2026-10-31', ...query },
    } as never,
    res as never,
  );
  return state;
}

beforeEach(() => {
  const tables = phase2World();
  tables.ost_members = [{ id: STAFF2.ost, status: 'active' }];
  for (const role of [
    ROLE2.viceDirector,
    ROLE2.seniorSalesManager,
    ROLE2.salesManager,
    ROLE2.ost,
  ]) {
    for (const key of ['sales.card_sales', 'network.commissions']) {
      tables.role_permissions!.push({
        role_id: role,
        module_id: moduleId(key),
        can_view: true,
        can_create: false,
        can_update: false,
        can_delete: false,
      });
    }
  }
  tables.card_sales = [
    {
      id: SALE.active,
      sale_number: 'MY-SALE',
      seller_staff_id: STAFF2.salesManager,
      origin: 'normal',
      status: 'active',
      cash_price_snapshot: '60000.00',
      created_at: '2026-10-03T12:00:00Z',
    },
    {
      id: SALE.submitted,
      sale_number: 'OST-SALE',
      seller_staff_id: STAFF2.ost,
      origin: 'normal',
      status: 'submitted',
      cash_price_snapshot: '30000.00',
      created_at: '2026-10-04T12:00:00Z',
    },
    {
      id: SALE.unpaid,
      sale_number: 'UNRELATED',
      seller_staff_id: STAFF2.hr,
      origin: 'normal',
      status: 'active',
      cash_price_snapshot: '90000.00',
      created_at: '2026-10-05T12:00:00Z',
    },
  ];
  tables.card_sale_hierarchy_snapshots = [
    STAFF2.viceDirector,
    STAFF2.seniorSalesManager,
    STAFF2.salesManager,
  ].map((ancestor_staff_id) => ({ sale_id: SALE.submitted, ancestor_staff_id }));
  tables.commissions = [
    'pending',
    'payment_verified',
    'final_qualification_pending',
    'earned',
    'paid',
    'cancelled',
  ].map((status, i) => ({
    id: `commission-${i}`,
    sale_id: SALE.active,
    beneficiary_staff_id: STAFF2.salesManager,
    beneficiary_type: 'staff',
    amount: '10.01',
    status,
    created_at: '2026-10-05T12:00:00Z',
  }));
  tables.commissions.push(
    {
      id: 'team',
      sale_id: SALE.submitted,
      beneficiary_staff_id: STAFF2.ost,
      beneficiary_type: 'staff',
      amount: '100.00',
      status: 'paid',
      created_at: '2026-10-06T12:00:00Z',
    },
    {
      id: 'other',
      sale_id: SALE.unpaid,
      beneficiary_staff_id: STAFF2.hr,
      beneficiary_type: 'staff',
      amount: '999.00',
      status: 'earned',
      created_at: '2026-10-06T12:00:00Z',
    },
  );
  holder.db = new FakeSupabase({ tables, tokens: phase2WorldTokens() });
});

describe('role-based Team Commissions revision', () => {
  const directVdOst = '30303030-0000-4000-8000-000000000001';
  const directSsmOst = '30303030-0000-4000-8000-000000000002';
  const outsideOst = '30303030-0000-4000-8000-000000000003';
  const nestedOst = '30303030-0000-4000-8000-000000000004';

  beforeEach(() => {
    const db = holder.db as FakeSupabase;
    for (const [id, head] of [
      [directVdOst, STAFF2.viceDirector],
      [directSsmOst, STAFF2.seniorSalesManager],
      [outsideOst, STAFF2.hr],
      [nestedOst, STAFF2.ost],
    ]) {
      db.rows('staff_users').push({ id, full_name: `OST ${id.slice(-1)}`, status: 'active' });
      db.rows('staff_role_assignments').push({ staff_id: id, role_id: ROLE2.ost });
      db.rows('ost_members').push({ id, status: 'active' });
      db.rows('referral_relationships').push({
        subject_staff_id: id,
        upline_staff_id: head,
        hierarchy_role: 'ost',
        is_active: true,
        is_authoritative: true,
      });
    }
    const sellers = [
      STAFF2.viceDirector,
      STAFF2.seniorSalesManager,
      STAFF2.salesManager,
      STAFF2.ost,
      directVdOst,
      directSsmOst,
      outsideOst,
      nestedOst,
    ];
    db.rows('card_sales').splice(0);
    db.rows('commissions').splice(0);
    db.rows('card_sale_hierarchy_snapshots').splice(0);
    for (const [i, id] of sellers.entries()) {
      const sale = `sale-${i}`;
      db.rows('card_sales').push({
        id: sale,
        sale_number: `SALE-${i}`,
        seller_staff_id: id,
        origin: 'normal',
        status: 'active',
        cash_price_snapshot: '100.00',
        created_at: '2026-10-03T00:00:00.000Z',
      });
      for (const ancestor of [STAFF2.viceDirector, STAFF2.seniorSalesManager, STAFF2.salesManager])
        db.rows('card_sale_hierarchy_snapshots').push({
          sale_id: sale,
          ancestor_staff_id: ancestor,
        });
      for (const status of [
        'pending',
        'payment_verified',
        'final_qualification_pending',
        'earned',
        'paid',
        'cancelled',
      ])
        db.rows('commissions').push({
          id: `${i}-${status}`,
          commission_number: `COM-${i}-${status}`,
          sale_id: sale,
          beneficiary_staff_id: id,
          beneficiary_type: 'staff',
          amount: '1.01',
          status,
          created_at: '2026-10-31T23:59:59.999Z',
        });
    }
  });

  it.each([
    [
      TOKEN2.viceDirector,
      42,
      ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'],
      '14.14',
      '21.21',
    ],
    [TOKEN2.seniorSalesManager, 24, ['senior_sales_manager', 'ost'], '8.08', '12.12'],
    [TOKEN2.salesManager, 12, ['sales_manager', 'ost'], '4.04', '6.06'],
  ] as const)(
    'enforces the beneficiary role matrix for %s',
    async (token, total, roles, earned, pending) => {
      const result = await call(token, { view: 'team-commissions' });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        total,
        personal: { earned: '2.02', paid: '1.01' },
        teamCommissionOverview: { totals: { earned, toEarn: pending }, availableRoles: roles },
      });
      const rows = (result.body as { commissions: { memberRole: string; memberName: string }[] })
        .commissions;
      expect(rows.every((r) => roles.some((role) => role === r.memberRole))).toBe(true);
      expect(rows.some((r) => r.memberName === 'OST 3')).toBe(false);
    },
  );
  it('keeps VD organization totals deduplicated and breaks down beneficiaries by position', async () => {
    const result = await call(TOKEN2.viceDirector, { view: 'team-commissions' });
    expect(result.body).toMatchObject({
      teamCommissionOverview: {
        totals: { salesAmount: '700.00', earned: '14.14', paid: '7.07' },
        breakdown: [
          { role: 'vice_director', earned: '2.02' },
          { role: 'senior_sales_manager', earned: '2.02' },
          { role: 'sales_manager', earned: '2.02' },
          { role: 'ost', earned: '8.08' },
        ],
      },
    });
  });
  it('restricts SM monitoring to direct OST assignments, even with a broader genealogy projection', async () => {
    const result = await call(TOKEN2.salesManager, { view: 'team-commissions', role: 'ost' });
    expect(result.body).toMatchObject({
      total: 6,
      ost: { earned: '2.02', withSales: 1, withoutSales: 0 },
    });
    expect(JSON.stringify(result.body)).not.toContain('OST 4');
  });
  it('forbids role escalation filters and rejects client-selected ownership or team IDs', async () => {
    for (const token of [TOKEN2.seniorSalesManager, TOKEN2.salesManager])
      expect((await call(token, { view: 'team-commissions', role: 'vice_director' })).status).toBe(
        403,
      );
    for (const query of [
      { seller: outsideOst },
      { staffId: STAFF2.viceDirector },
      { teamId: STAFF2.viceDirector },
    ])
      expect((await call(TOKEN2.salesManager, { view: 'team-commissions', ...query })).status).toBe(
        400,
      );
  });
  it('filters history by allowed role, lifecycle status and literal search without changing period totals', async () => {
    const result = await call(TOKEN2.viceDirector, {
      view: 'team-commissions',
      role: 'sales_manager',
      status: 'paid',
      search: 'COM-2',
    });
    expect(result.body).toMatchObject({
      total: 1,
      commissions: [{ id: '2-paid', memberRole: 'sales_manager' }],
      teamCommissionOverview: { totals: { earned: '14.14' } },
    });
  });
  it('does not change other role dashboards or the separate My Commissions history', async () => {
    expect((await call(TOKEN2.viceDirector, { view: 'dashboard' })).body).toMatchObject({
      ost: { earned: '8.08' },
    });
    expect((await call(TOKEN2.salesManager, { view: 'my-commissions' })).body).toMatchObject({
      total: 6,
      personal: { earned: '2.02' },
    });
  });
  it('excludes a sibling SSM branch for SSM while retaining it in the VD organization', async () => {
    const db = holder.db as FakeSupabase;
    const sibling = '40404040-0000-4000-8000-000000000001';
    db.rows('staff_users').push({ id: sibling, full_name: 'SIBLING SSM', status: 'active' });
    db.rows('staff_role_assignments').push({
      staff_id: sibling,
      role_id: ROLE2.seniorSalesManager,
    });
    db.rows('referral_relationships').push({
      subject_staff_id: sibling,
      upline_staff_id: STAFF2.viceDirector,
      is_active: true,
      is_authoritative: true,
    });
    db.rows('commissions').push({
      id: 'sibling-paid',
      sale_id: 'sale-0',
      beneficiary_staff_id: sibling,
      amount: '1.01',
      status: 'paid',
      created_at: '2026-10-31T23:59:59.999Z',
    });
    const ssm = await call(TOKEN2.seniorSalesManager, { view: 'team-commissions' });
    expect(ssm.body).toMatchObject({ total: 24 });
    expect(JSON.stringify(ssm.body)).not.toContain('SIBLING SSM');
    const vd = await call(TOKEN2.viceDirector, {
      view: 'team-commissions',
      role: 'senior_sales_manager',
    });
    expect(vd.body).toMatchObject({
      total: 7,
      teamCommissionOverview: { totals: { paid: '8.08' } },
    });
  });
  it('excludes another VD and their OST branch even when historical snapshots overlap', async () => {
    const db = holder.db as FakeSupabase;
    const otherVd = '40404040-0000-4000-8000-000000000002';
    db.rows('staff_users').push({ id: otherVd, full_name: 'OTHER VD', status: 'active' });
    db.rows('staff_role_assignments').push({ staff_id: otherVd, role_id: ROLE2.viceDirector });
    db
      .rows('referral_relationships')
      .find((r) => r.subject_staff_id === outsideOst)!.upline_staff_id = otherVd;
    db.rows('commissions').push({
      id: 'other-vd-paid',
      sale_id: 'sale-0',
      beneficiary_staff_id: otherVd,
      amount: '9999.99',
      status: 'paid',
      created_at: '2026-10-31T23:59:59.999Z',
    });
    const result = await call(TOKEN2.viceDirector, { view: 'team-commissions' });
    expect(result.body).toMatchObject({
      total: 42,
      teamCommissionOverview: { totals: { earned: '14.14' } },
    });
    expect(JSON.stringify(result.body)).not.toContain('9999.99');
  });
});

describe('IST portal ownership and monitoring', () => {
  it('separates personal ownership, frozen sale values and recorded earnings', async () => {
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      personal: {
        salesCount: 1,
        qualifyingSales: 1,
        salesAmount: '60000.00',
        toEarn: '30.03',
        earned: '20.02',
        paid: '10.01',
      },
      ost: { salesCount: 1, earned: '100.00', paid: '100.00' },
    });
  });
  it.each([TOKEN2.viceDirector, TOKEN2.seniorSalesManager, TOKEN2.salesManager])(
    'scopes team commission reads for %s',
    async (token) => {
      const result = await call(token, { view: 'team-commissions' });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ total: token === TOKEN2.salesManager ? 7 : 1 });
      expect((result.body as { commissions: { id: string }[] }).commissions).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'team' })]),
      );
      expect(JSON.stringify(result.body)).not.toContain('999.00');
    },
  );
  it('does not infer historical entitlement from current genealogy', async () => {
    (holder.db as FakeSupabase).rows('card_sale_hierarchy_snapshots').splice(0);
    expect((await call(undefined, { view: 'team-commissions' })).body).toMatchObject({
      total: 6,
      ost: { earned: '0.00' },
    });
  });
  it('requires current downline authorization even for an old snapshot', async () => {
    (holder.db as FakeSupabase).rows('referral_relationships').forEach((r) => {
      if (r.subject_staff_id === STAFF2.ost) r.upline_staff_id = STAFF2.hr;
    });
    expect((await call(undefined, { view: 'team-commissions' })).body).toMatchObject({
      total: 6,
      ost: { earned: '0.00' },
    });
  });
  it('forbids OST team monitoring and other staff roles', async () => {
    expect((await call(TOKEN2.ost, { view: 'team-commissions' })).status).toBe(403);
    expect((await call(TOKEN2.finance)).status).toBe(403);
    expect((await call(TOKEN2.ost, { view: 'my-sales' })).body).toMatchObject({
      sales: [{ saleNumber: 'OST-SALE' }],
    });
  });
  it('rejects writes, malformed dates and inverted ranges', async () => {
    expect((await call(undefined, {}, 'POST')).status).toBe(405);
    for (const query of [{ from: '2026-02-30' }, { from: '2026-11-01', to: '2026-10-01' }])
      expect((await call(undefined, query)).status).toBe(400);
  });
  it('uses one inclusive UTC creation period for sales and commissions', async () => {
    expect((await call(undefined, { from: '2026-10-06', to: '2026-10-06' })).body).toMatchObject({
      personal: { salesCount: 0, earned: '0.00' },
      ost: { earned: '100.00' },
    });
  });
  it('rechecks effective commission permissions', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('role_permissions').forEach((r) => {
      if (r.role_id === ROLE2.salesManager && r.module_id === moduleId('network.commissions'))
        r.can_view = false;
    });
    expect((await call(undefined, { view: 'my-commissions' })).status).toBe(403);
    expect((await call()).body).toMatchObject({
      personal: { earned: null },
      ost: { earned: null },
    });
  });
  it('returns personal history without treating team commissions as personal', async () => {
    const result = await call(undefined, { view: 'my-commissions' });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ total: 6 });
    expect(
      (result.body as { commissions: { id: string }[] }).commissions.map((c) => c.id),
    ).not.toContain('team');
  });
  it.each([STAFF2.viceDirector, STAFF2.seniorSalesManager])(
    'supports direct OST relationships with %s',
    async (upline) => {
      const edge = (holder.db as FakeSupabase)
        .rows('referral_relationships')
        .find((r) => r.subject_staff_id === STAFF2.ost)!;
      edge.upline_staff_id = upline;
      const token =
        upline === STAFF2.viceDirector ? TOKEN2.viceDirector : TOKEN2.seniorSalesManager;
      expect((await call(token, { view: 'team-commissions' })).body).toMatchObject({ total: 1 });
      expect((await call(TOKEN2.salesManager, { view: 'team-commissions' })).body).toMatchObject({
        total: 6,
      });
    },
  );
  it('paginates without truncating totals at the database response cap', async () => {
    const db = holder.db as FakeSupabase;
    const original = db.rows('commissions')[0]!;
    db.rows('commissions').splice(
      0,
      6,
      ...Array.from({ length: 501 }, (_, i) => ({
        ...original,
        id: `bulk-${String(i).padStart(4, '0')}`,
        amount: '0.01',
      })),
    );
    const result = await call(undefined, { view: 'my-commissions', page: '21' });
    expect(result.body).toMatchObject({
      total: 501,
      personal: { toEarn: '5.01' },
      commissions: [{ id: 'bulk-0500' }],
    });
  });
  it('does not disclose customer names without the customer permission', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('card_sales')[0]!.customer_id = 'private-customer';
    db.rows('customers').push({
      id: 'private-customer',
      first_name: 'ANA',
      last_name: 'REYES',
      government_id_number: 'never-return-this',
    });
    db.rows('role_permissions').forEach((r) => {
      if (r.role_id === ROLE2.salesManager && r.module_id === moduleId('sales.customers'))
        r.can_view = false;
    });
    const result = await call(undefined, { view: 'my-sales' });
    expect(result.body).toMatchObject({ sales: [{ customerName: null }] });
    expect(JSON.stringify(result.body)).not.toContain('never-return-this');
  });
  it('reads customer name parts from the existing customer schema', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('card_sales')[0]!.customer_id = 'customer';
    db.rows('customers').push({
      id: 'customer',
      first_name: 'ANA',
      middle_name: null,
      last_name: 'REYES',
      suffix: null,
    });
    expect((await call(undefined, { view: 'my-sales' })).body).toMatchObject({
      sales: [{ customerName: 'ANA REYES' }],
    });
  });
  it('shows an existing employee number and uses the current genealogy head projection', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('staff_users').find((r) => r.id === STAFF2.salesManager)!.employee_number = 'AF-003';
    const head = db.rows('staff_users').find((r) => r.id === STAFF2.seniorSalesManager)!;
    expect((await call()).body).toMatchObject({
      account: { staffNumber: 'AF-003', head: head.full_name },
      team: { total: 1, active: 1 },
    });
  });
  it('keeps authorized OST monitoring through a departed head without reassigning history', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('staff_users').find((r) => r.id === STAFF2.salesManager)!.status = 'inactive';
    db
      .rows('referral_relationships')
      .find((r) => r.subject_staff_id === STAFF2.salesManager)!.is_active = false;
    expect(
      (await call(TOKEN2.seniorSalesManager, { view: 'team-commissions' })).body,
    ).toMatchObject({ total: 1, commissions: [{ id: 'team' }] });
  });
});
