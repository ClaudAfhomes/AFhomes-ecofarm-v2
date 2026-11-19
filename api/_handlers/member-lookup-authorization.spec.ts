import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseTables, baseTokens, TOKEN, UUID, moduleId } from '../_lib/testing/fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const memberships = (await import('./memberships.js')).default;
const customerId = '11111111-1111-4111-8111-111111111111';
function install(allowed = true) {
  const tables = baseTables();
  if (allowed)
    tables.role_permissions.push({
      role_id: UUID.role.employee,
      module_id: moduleId('operations.redemption'),
      can_view: true,
      can_create: false,
      can_update: false,
      can_delete: false,
    });
  holder.db = new FakeSupabase({
    tables,
    tokens: baseTokens(),
    rpcs: [
      {
        fn: 'customer_directory',
        result: [
          {
            record: {
              id: customerId,
              full_name: 'Disposable QA',
              customer_number: 'CUS-QA',
              membership_number: 'MBS-000123',
              tier: 'GOLD',
              member_status: 'active',
              derivedCategory: 'ACTIVE_VIP',
              activated_at: '2025-01-01',
              expires_at: '2035-01-01',
              available_points: '12500',
              email: 'private@example.invalid',
              address: { line1: 'private' },
              tin: 'private',
              auth_user_id: 'private',
              verified_paid: '312000.00',
            },
            total_count: 1,
          },
        ],
      },
    ],
  });
  return holder.db;
}
async function lookup(token: string) {
  const { res, state } = makeRes();
  await memberships(
    makeReq({ method: 'GET', familyPath: 'lookup', query: { search: 'Disposable' }, token }),
    res,
  );
  return state;
}
afterEach(() => vi.clearAllMocks());
describe('member directory authorization remains server controlled', () => {
  it('returns only safe fields for an Employee holding the existing lookup permission', async () => {
    install();
    const result = await lookup(TOKEN.viewer);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      data: [
        {
          membershipNumber: 'MBS-000123',
          memberName: 'Disposable QA',
          customerNumber: 'CUS-QA',
          tier: 'GOLD',
          membershipStatus: 'active',
          category: 'ACTIVE_VIP',
          activatedAt: '2025-01-01',
          expiresAt: '2035-01-01',
          availablePoints: '12500',
          mayUsePrivileges: true,
        },
      ],
      meta: { total: 1, limit: 50, offset: 0 },
    });
  });
  it('denies an Employee lacking lookup permission before invoking directory', async () => {
    const db = install(false);
    expect((await lookup(TOKEN.viewer)).status).toBe(403);
    expect(db.calls.some((c) => c.op === 'rpc' && c.table === 'customer_directory')).toBe(false);
  });
  it('honors a deny-only Employee restriction', async () => {
    const db = install();
    db.tables.staff_permission_restrictions.push({
      staff_id: UUID.viewerStaff,
      module_id: moduleId('operations.redemption'),
      deny_view: true,
      deny_create: false,
      deny_update: false,
      deny_delete: false,
    });
    expect((await lookup(TOKEN.viewer)).status).toBe(403);
  });
  it.each(['customer', 'ost'])(
    'denies a %s Auth principal without staff authorization',
    async (kind) => {
      const db = install();
      db.tokens[kind] = { id: customerId, email: kind + '@example.invalid' };
      expect((await lookup(kind)).status).toBe(403);
    },
  );
  it('allows an Admin with the existing lookup permission', async () => {
    const db = install();
    db.tables.role_permissions.push({
      role_id: UUID.role.admin,
      module_id: moduleId('operations.redemption'),
      can_view: true,
      can_create: false,
      can_update: false,
      can_delete: false,
    });
    expect((await lookup(TOKEN.admin)).status).toBe(200);
  });
});
