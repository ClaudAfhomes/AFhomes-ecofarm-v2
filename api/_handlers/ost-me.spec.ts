/**
 * `GET /ost/me` - the OST portal's own record.
 *
 * Authenticated (any valid session), self-scoped by Auth id. Returns only
 * the caller's safe member fields; a non-OST caller gets the same 404 as an
 * unknown member, with no oracle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const ost = (await import('./ost.js')).default;
const { resetIdentifierRateLimit } = await import('../_lib/rate-limit.js');

const OST_ID = '55555555-5555-4555-8555-555555555555';
const SM_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '99999999-9999-4999-8999-999999999999';

function install() {
  resetIdentifierRateLimit();
  holder.db = new FakeSupabase({
    rpcs: [{ fn: 'account_imported_sales', result: [] }],
    tables: {
      modules: [],
      roles: [],
      role_permissions: [],
      staff_users: [
        {
          id: OST_ID,
          email: 'ost@afhomes.test',
          full_name: 'Ollie Seller',
          status: 'active',
          must_change_password: false,
        },
        { id: SM_ID, email: 'sm@afhomes.test', full_name: 'Sam Manager', status: 'active' },
        { id: OTHER_ID, email: 'other@afhomes.test', full_name: 'Other Person', status: 'active' },
      ],
      staff_role_assignments: [],
      staff_permission_restrictions: [],
      staff_invitations: [],
      referral_codes: [],
      ost_applications: [],
      ost_members: [
        {
          id: OST_ID,
          application_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0',
          sponsor_staff_id: SM_ID,
          ost_number: 'OST-000007',
          full_name: 'Ollie Seller',
          email: 'ost@afhomes.test',
          phone: '+639170000007',
          status: 'active',
          approved_by: SM_ID,
          approved_at: '2026-09-01T00:00:00.000Z',
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
      referral_relationships: [],
      audit_events: [],
    } as never,
    tokens: {
      'tok-ost': {
        id: OST_ID,
        email: 'ost@afhomes.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
      'tok-other': {
        id: OTHER_ID,
        email: 'other@afhomes.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
    },
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

async function call(token?: string, path = 'me') {
  const { res, state } = makeRes();
  await ost(
    makeReq({ method: 'GET', familyPath: path, ...(token ? { token } : {}) }) as never,
    res as never,
  );
  return state as { status: number; body: unknown };
}

describe('GET /ost/me', () => {
  it.each(['card_sales', 'commissions'])(
    'does not return a partial dashboard when %s fails',
    async (table) => {
      install();
      const db = holder.db as FakeSupabase;
      db.errors[table] = { message: 'PRIVATE dashboard read failure' };
      const result = await call('tok-ost', 'me/dashboard');
      expect(result.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(result.body)).not.toContain('PRIVATE');
    },
  );

  it('keeps commission totals exact and restricted to the current OST', async () => {
    install();
    const db = holder.db as FakeSupabase;
    const saleId = '44444444-4444-4444-8444-444444444444';
    db.rows('card_sales').push({
      id: saleId,
      sale_number: 'AF-SALE-261023-001',
      seller_ost_id: OST_ID,
      origin: 'normal',
      status: 'active',
    });
    db.rows('commissions').push(
      ...[OST_ID, OTHER_ID].map((id, i) => ({
        id: `66666666-6666-4666-8666-66666666666${i}`,
        sale_id: saleId,
        beneficiary_ost_id: id,
        amount: i ? '99999.99' : '0.10',
        status: 'earned',
        created_at: '2026-10-23T00:00:00Z',
        settled_before_system: false,
      })),
    );
    const result = await call('tok-ost', 'me/dashboard');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      sales: { totalSales: 1, periodSales: 1 },
      commissions: { earned: { count: 1, amount: '0.10' } },
    });
    expect(JSON.stringify(result.body)).not.toContain('99999.99');
  });

  it('starts independent dashboard reads together after account verification', async () => {
    install();
    const db = holder.db as FakeSupabase;
    const from = db.from.bind(db);
    const started = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(db, 'from').mockImplementation((table) => {
      const query = from(table);
      if (table === 'staff_role_assignments') {
        const maybeSingle = query.maybeSingle.bind(query);
        query.maybeSingle = () => {
          started.add(table);
          return gate.then(() => maybeSingle());
        };
      } else if (['card_sales', 'commissions'].includes(table)) {
        const then = query.then.bind(query);
        query.then = (fulfilled, rejected) => {
          started.add(table);
          return gate.then(() => then(fulfilled, rejected));
        };
      }
      return query;
    });
    const pending = call('tok-ost', 'me/dashboard');
    try {
      await vi.waitFor(() => expect(started.size).toBe(3), { timeout: 300 });
    } finally {
      release();
      expect((await pending).status).toBe(200);
      spy.mockRestore();
    }
  });

  it.each(['staff_users', 'ost_members'])(
    'does not load dashboard data for restricted %s',
    async (table) => {
      install();
      const db = holder.db as FakeSupabase;
      db.rows(table).find((row) => row.id === OST_ID)!.status = 'suspended';
      const from = vi.spyOn(db, 'from');
      expect((await call('tok-ost', 'me/dashboard')).status).toBe(403);
      expect(from.mock.calls.map(([name]) => name)).not.toContain('commissions');
      expect(from.mock.calls.map(([name]) => name)).not.toContain('card_sales');
      from.mockRestore();
    },
  );

  it('shows staff-backed OST commissions but excludes pre-system settlement history', async () => {
    install();
    const db = holder.db as FakeSupabase;
    db.rows('card_sales').push({
      id: '44444444-4444-4444-8444-444444444444',
      sale_number: 'AF-SALE-261023-001',
    });
    db.rows('commissions').push(
      ...[false, true].map((settled, i) => ({
        id: `66666666-6666-4666-8666-66666666666${i}`,
        sale_id: '44444444-4444-4444-8444-444444444444',
        beneficiary_staff_id: OST_ID,
        beneficiary_ost_id: null,
        amount: '2880.00',
        status: 'payment_verified',
        created_at: '2026-10-23T00:00:00Z',
        qualified_at: null,
        earned_at: null,
        paid_at: null,
        settled_before_system: settled,
      })),
    );
    const result = await call('tok-ost', 'me/commissions');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      data: [{ amount: '2880.00', status: 'payment_verified' }],
      meta: { total: 1 },
    });
  });
  it('refuses an OST whose staff activation is incomplete', async () => {
    install();
    const staff = (holder.db as FakeSupabase).rows('staff_users').find((row) => row.id === OST_ID)!;
    staff.status = 'invited';
    expect((await call('tok-ost')).status).toBe(403);
  });
  it('blocks the temporary password until the server flag is cleared', async () => {
    install();
    const db = holder.db as FakeSupabase;
    const staff = db.rows('staff_users').find((row) => row.id === OST_ID)!;
    staff.must_change_password = true;
    const denied = await call('tok-ost');
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain('OST-000007');
    staff.must_change_password = false;
    expect((await call('tok-ost')).status).toBe(200);
  });

  it('fails closed when the password requirement cannot be read', async () => {
    install();
    (holder.db as FakeSupabase).errors['staff_users'] = { message: 'PRIVATE lookup error' };
    const denied = await call('tok-ost');
    expect(denied.status).toBe(503);
    expect(JSON.stringify(denied.body)).not.toContain('PRIVATE');
  });

  it('returns the caller own safe record with the sponsor name', async () => {
    install();
    const s = await call('tok-ost');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({
      ostNumber: 'OST-000007',
      fullName: 'Ollie Seller',
      status: 'active',
      sponsorName: 'Sam Manager',
    });
    const serialised = JSON.stringify(s.body);
    expect(serialised).not.toContain(OST_ID);
    expect(serialised).not.toContain(SM_ID);
    expect(serialised).not.toContain('ost@afhomes.test');
  });

  it('a non-OST caller gets the same 404', async () => {
    install();
    const s = await call('tok-other');
    expect(s.status).toBe(404);
  });

  it('requires a session', async () => {
    install();
    expect((await call()).status).toBe(401);
    expect((await call('tok-bogus')).status).toBe(401);
  });
});
