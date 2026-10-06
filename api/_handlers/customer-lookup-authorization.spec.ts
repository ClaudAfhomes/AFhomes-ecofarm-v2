import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseTables, baseTokens, TOKEN, UUID, moduleId } from '../_lib/testing/fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const memberships = (await import('./memberships.js')).default;

/**
 * Customer Lookup is the GSD/Employee desk. These tests pin the two properties that
 * separate it from the member-TRANSACTION lookup that shares a handler file:
 *
 * 1. It is READ-ONLY, and it is read-only because the permission it requires carries
 *    no `create`/`update`/`delete` and no sibling mutating handler exists on this path.
 *    A GSD operator who can reach this screen cannot edit a customer, take a payment,
 *    activate a membership or spend points.
 * 2. It NEVER returns a Membership Code - not current, not legacy, not in the
 *    `AFHOMES:` envelope, and not a QR or fallback credential. The response has no
 *    field one could be rendered into, which is why this is asserted on the response
 *    BODY rather than on a UI that could be changed tomorrow.
 */

const customerId = '11111111-1111-4111-8111-111111111111';

/** What `customer_directory` actually returns: `c.*` plus the membership join. */
const DIRECTORY_RECORD = {
  record: {
    id: customerId,
    full_name: 'PROSPECT DELA CRUZ',
    customer_number: 'AF-CUS-00042',
    customer_code: 'AF-CC-1A2B3C4D',
    status: 'prospect',
    // Present in the row because the SQL selects `c.*` and left-joins memberships.
    // None of it may reach this response.
    membership_number: 'MBS-A1B2C3D4-E5F60718-293A4B5C-6D7E8F90',
    member_status: null,
    tier: null,
    expires_at: null,
    derivedCategory: 'PENDING',
    available_points: '0',
    fallback_code_hash: 'never-returned',
    qr_token_hash: 'never-returned',
    government_id_number: 'never-returned',
    email: 'never-returned@example.invalid',
    phone: 'never-returned',
    auth_user_id: 'never-returned',
    verified_paid: '0.00',
  },
  total_count: 1,
};

function install({
  allowed = true,
  grant = {},
}: { allowed?: boolean; grant?: Record<string, boolean> } = {}) {
  const tables = baseTables();
  if (allowed)
    tables.role_permissions.push({
      role_id: UUID.role.employee,
      module_id: moduleId('operations.redemption'),
      can_view: true,
      // Explicitly false: an Employee's GSD desk is a lookup, not a till. These are
      // the baseline's real values, restated here so the test fails if someone
      // quietly widens the grant this route depends on.
      can_create: grant.canCreate ?? false,
      can_update: grant.canUpdate ?? false,
      can_delete: grant.canDelete ?? false,
    });
  holder.db = new FakeSupabase({
    tables,
    tokens: baseTokens(),
    rpcs: [{ fn: 'customer_directory', result: [DIRECTORY_RECORD] }],
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

describe('Customer Lookup (GSD) is read-only and exposes no Membership credential', () => {
  it('serves an Employee who holds only the lookup permission', async () => {
    install();
    const s = await lookup(TOKEN.viewer);
    expect(s.status).toBe(200);
    const body = s.body as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      customerNumber: 'AF-CUS-00042',
      customerCode: 'AF-CC-1A2B3C4D',
      fullName: 'PROSPECT DELA CRUZ',
      customerStatus: 'prospect',
      membershipStatus: null,
      tier: null,
    });
  });

  it('refuses a caller with no permission at all, before reaching the database', async () => {
    const db = install({ allowed: false });
    let called = false;
    const original = db.rpc.bind(db);
    db.rpc = async (...args: Parameters<FakeSupabase['rpc']>) => {
      called = true;
      return original(...args);
    };
    const s = await lookup(TOKEN.unassigned);
    expect(s.status).toBe(403);
    expect(called).toBe(false);
  });

  it('never returns a Membership Code, credential or identity field', async () => {
    install();
    const s = await lookup(TOKEN.viewer);
    // Assert on the serialized body, not on named fields: a new field could be added
    // that leaks, and this catches it.
    const serialized = JSON.stringify(s.body);
    expect(serialized).not.toContain('MBS-A1B2C3D4');
    expect(serialized).not.toContain('membership_number');
    expect(serialized).not.toContain('membershipNumber');
    expect(serialized).not.toContain('fallback_code_hash');
    expect(serialized).not.toContain('qr_token_hash');
    expect(serialized).not.toContain('government_id_number');
    expect(serialized).not.toContain('auth_user_id');
    expect(serialized).not.toContain('example.invalid');
  });

  it('keeps Customer Status and Membership Status as separate facts', async () => {
    install();
    const s = await lookup(TOKEN.viewer);
    const row = (s.body as { data: Array<Record<string, unknown>> }).data[0];
    // Both keys must exist, so a screen cannot be forced to invent one from the other.
    expect(row).toHaveProperty('customerStatus');
    expect(row).toHaveProperty('membershipStatus');
    expect(row?.customerStatus).not.toBe(row?.membershipStatus ?? undefined);
  });

  it('searches ALL customers, not only members', async () => {
    const db = install();
    const seen: Array<Record<string, unknown>> = [];
    const original = db.rpc.bind(db);
    db.rpc = async (...args: Parameters<FakeSupabase['rpc']>) => {
      seen.push((args[1] as { p_filters: Record<string, unknown> })?.p_filters ?? {});
      return original(...args);
    };
    await lookup(TOKEN.viewer);
    // The filter must NOT be membersOnly: a GSD operator has to find prospects and
    // suspended accounts, which are precisely the calls that arrive at this desk.
    expect(seen[0]).toMatchObject({ membersOnly: false });
  });

  it('requires at least two characters, like every other lookup', async () => {
    install();
    const s = await lookup(TOKEN.viewer, 'A');
    expect(s.status).toBe(400);
  });

  it('refuses a mutating method on the lookup path', async () => {
    install();
    const { res, state } = makeRes();
    await memberships(
      makeReq({ method: 'POST', familyPath: 'customer-lookup', token: TOKEN.viewer }),
      res,
    );
    // No POST branch exists for this path, so it must not be readable, let alone
    // able to write. Anything but 404 means a mutating route appeared here.
    expect(state.status).toBe(404);
  });

  it('does not become writable when the shared module gains a create grant', async () => {
    // The permission key is shared with the till. Even with `create` present on the
    // grant, this route still has no mutating branch - which is the property that
    // makes "read-only by construction" true rather than aspirational.
    install({ grant: { canCreate: true } });
    const { res, state } = makeRes();
    await memberships(
      makeReq({ method: 'POST', familyPath: 'customer-lookup', token: TOKEN.viewer }),
      res,
    );
    expect(state.status).toBe(404);
  });
});
