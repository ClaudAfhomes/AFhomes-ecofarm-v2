import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseTables, baseTokens, TOKEN, UUID, moduleId } from '../_lib/testing/fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const memberships = (await import('./memberships.js')).default;

/**
 * Customer Lookup is the GSD/Employee desk. These tests pin the properties that
 * separate it from the member-TRANSACTION lookup that shares a handler file:
 *
 * 1. It is READ-ONLY (view-only permission, no mutating branch on this path).
 * 2. It returns ONLY active VIPs (customer active + active unexpired membership
 *    on a BRONZE/SILVER/GOLD plan), enforced server-side before paging.
 * 3. It never returns Membership Codes, credentials, or fields outside the
 *    authorized staff display projection.
 * 4. It is its own module (`operations.customer_lookup`), so the till key does
 *    not open it.
 */
const customerId = '11111111-1111-4111-8111-111111111111';

/** What `customer_directory` actually returns for an eligible active VIP. */
const DIRECTORY_RECORD = {
  record: {
    id: customerId,
    first_name: 'Juan',
    middle_name: null,
    last_name: 'Dela Cruz',
    suffix: null,
    full_name: 'JUAN DELA CRUZ',
    customer_number: 'AF-CUS-00042',
    customer_code: 'AF-CC-1A2B3C4D',
    status: 'active',
    // Sensitive fields present in the raw row (c.* join). None may reach the response.
    membership_number: 'MBS-A1B2C3D4-E5F60718-293A4B5C-6D7E8F90',
    member_status: 'active',
    tier: 'GOLD',
    expires_at: '2033-10-21T00:00:00.000Z',
    derivedCategory: 'ACTIVE_VIP',
    available_points: '0',
    fallback_code_hash: 'never-returned',
    qr_token_hash: 'never-returned',
    government_id_number: 'never-returned',
    email: 'never-returned@example.invalid',
    phone: 'never-returned',
    auth_user_id: 'never-returned',
    verified_paid: '0.00',
    payment_status: 'fully_paid',
    company_status: null,
    stated_vip_package: 'GOLD',
    supplementary_full_name: null,
  },
  total_count: 1,
};

function install({
  allowed = true,
  grant = {},
  rows = [DIRECTORY_RECORD],
}: { allowed?: boolean; grant?: Record<string, boolean>; rows?: Array<unknown> } = {}) {
  const tables = baseTables();
  if (allowed)
    tables.role_permissions.push({
      role_id: UUID.role.employee,
      module_id: moduleId('operations.customer_lookup'),
      can_view: true,
      can_create: grant.canCreate ?? false,
      can_update: grant.canUpdate ?? false,
      can_delete: grant.canDelete ?? false,
    });
  holder.db = new FakeSupabase({
    tables,
    tokens: baseTokens(),
    rpcs: [{ fn: 'customer_directory', result: rows }],
  });
  return holder.db;
}

async function lookup(token: string, search = 'DELA') {
  const { res, state } = makeRes();
  await memberships(
    makeReq({ method: 'GET', familyPath: 'customer-lookup', query: { search }, token }),
    res,
  );
  return state;
}

afterEach(() => vi.clearAllMocks());

describe('Customer Lookup (GSD) is read-only and returns only active VIPs', () => {
  it('serves an Employee who holds only the lookup permission', async () => {
    install();
    const s = await lookup(TOKEN.viewer);
    expect(s.status).toBe(200);
    const body = s.body as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      firstName: 'Juan',
      lastName: 'Dela Cruz',
      vipTier: 'GOLD',
      validUntil: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(body.data[0]).not.toHaveProperty('maskedLastName');
    expect(JSON.stringify(body.data[0])).toContain('Dela Cruz');
    expect(Object.keys(body.data[0]!)).toEqual([
      'firstName',
      'lastName',
      'raNumber',
      'vipCardNumber',
      'vipTier',
      'validUntil',
      'totalAvailablePoints',
      'weekendAvailablePoints',
      'weekdayAvailablePoints',
      'governmentIdImageUrl',
    ]);
  });

  it('refuses a caller with no permission at all, before reaching the database', async () => {
    const db = install({ allowed: false });
    let called = false;
    const original = db.rpc.bind(db);
    db.rpc = async (...args: Parameters<FakeSupabase['rpc']>) => {
      if (args[0] !== 'afhomes_admin_mfa_required') called = true;
      return original(...args);
    };
    const s = await lookup(TOKEN.unassigned);
    expect(s.status).toBe(403);
    expect(called).toBe(false);
  });

  it('refuses the till permission: redemption alone does not open the lookup', async () => {
    const db = install({ allowed: false });
    db.tables['role_permissions']!.push({
      role_id: UUID.role.employee,
      module_id: moduleId('operations.redemption'),
      can_view: true,
      can_create: false,
      can_update: false,
      can_delete: false,
    });
    let called = false;
    const original = db.rpc.bind(db);
    db.rpc = async (...args: Parameters<FakeSupabase['rpc']>) => {
      if (args[0] !== 'afhomes_admin_mfa_required') called = true;
      return original(...args);
    };
    const s = await lookup(TOKEN.viewer);
    expect(s.status).toBe(403);
    expect(called).toBe(false);
  });

  it('never returns a Membership Code, credential, identifier, status, or extra field', async () => {
    install();
    const s = await lookup(TOKEN.viewer);
    const serialized = JSON.stringify(s.body);
    for (const forbidden of [
      'MBS-A1B2C3D4',
      'membership_number',
      'membershipNumber',
      'fallback_code_hash',
      'qr_token_hash',
      'government_id_number',
      'auth_user_id',
      'example.invalid',
      'customerNumber',
      'customerCode',
      'customerId',
      'fullName',
      'customerStatus',
      'membershipStatus',
      'membershipExpiresAt',
      'category',
      'paymentStatus',
      'companyStatus',
      'statedVipPackage',
      'supplementaryFullName',
      'AF-CUS-',
      'AF-CC-',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('enforces active-VIP filters server-side before paging', async () => {
    const db = install();
    const seen: Array<Record<string, unknown>> = [];
    const original = db.rpc.bind(db);
    db.rpc = async (...args: Parameters<FakeSupabase['rpc']>) => {
      if (args[0] !== 'afhomes_admin_mfa_required')
        seen.push((args[1] as { p_filters: Record<string, unknown> })?.p_filters ?? {});
      return original(...args);
    };
    await lookup(TOKEN.viewer);
    expect(seen[0]).toMatchObject({
      membersOnly: true,
      status: 'active',
      activeVipOnly: true,
    });
  });

  it('requires at least two characters, like every other lookup', async () => {
    install();
    const s = await lookup(TOKEN.viewer, 'A');
    expect(s.status).toBe(400);
  });

  it('returns an empty list when the directory returns no rows', async () => {
    install({ rows: [] });
    const s = await lookup(TOKEN.viewer);
    expect(s.status).toBe(200);
    const body = s.body as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('refuses a mutating method on the lookup path', async () => {
    install();
    const { res, state } = makeRes();
    await memberships(
      makeReq({ method: 'POST', familyPath: 'customer-lookup', token: TOKEN.viewer }),
      res,
    );
    expect(state.status).toBe(404);
  });

  it('does not become writable when its module gains a create grant', async () => {
    install({ grant: { canCreate: true } });
    const { res, state } = makeRes();
    await memberships(
      makeReq({ method: 'POST', familyPath: 'customer-lookup', token: TOKEN.viewer }),
      res,
    );
    expect(state.status).toBe(404);
  });
});
