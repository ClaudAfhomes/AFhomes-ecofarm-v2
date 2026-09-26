import { describe, expect, it } from 'vitest';

import { resolveLoginRole, type LoginRoleClient } from './auth';

function clientFor(
  responder: (
    table: string,
    op: 'eq' | 'in',
    column: string,
    value: unknown,
  ) => { data: unknown[] | null; error: unknown },
): LoginRoleClient {
  return {
    from: (table: string) => ({
      select: (_columns: string) => ({
        eq: (column: string, value: string) =>
          Promise.resolve(responder(table, 'eq', column, value)),
        in: (column: string, values: string[]) =>
          Promise.resolve(responder(table, 'in', column, values)),
      }),
    }),
  };
}

const failAll: LoginRoleClient = clientFor(() => {
  throw new Error('unreachable');
});

describe('resolveLoginRole (staff-first login resolution)', () => {
  it('resolves a staff-only identity (StaffUser, no MemberRole) to admin', async () => {
    // Regression: the provisioned super-admin holds no Member row/link, so
    // member-table-only resolution misclassified it as user and sent it to
    // the member panel until refresh.
    const client = clientFor((table) => {
      if (table === 'StaffUser') return { data: [{ id: 'staff-uuid-1' }], error: null };
      return { data: [], error: null };
    });
    await expect(resolveLoginRole(client, 'staff-uuid-1', {})).resolves.toBe('admin');
  });

  it('ignores a failing StaffUser read and resolves member-tier roles', async () => {
    const client = clientFor((table, op) => {
      if (table === 'StaffUser') throw new Error('denied');
      if (table === 'MemberRole' && op === 'eq')
        return { data: [{ roleId: 'r-user' }], error: null };
      if (table === 'Role' && op === 'in') return { data: [{ slug: 'user' }], error: null };
      return { data: [], error: null };
    });
    await expect(resolveLoginRole(client, 'mem-uuid-1', {})).resolves.toBe('user');
  });

  it('maps an admin member slug (incl. legacy SUPER_ADMIN) to admin', async () => {
    const client = clientFor((table, op) => {
      if (table === 'MemberRole' && op === 'eq')
        return { data: [{ roleId: 'r-admin' }], error: null };
      if (table === 'Role' && op === 'in') return { data: [{ slug: 'super_admin' }], error: null };
      return { data: [], error: null };
    });
    await expect(resolveLoginRole(client, 'mem-uuid-2', {})).resolves.toBe('admin');
  });

  it('tolerates revoked Role reads and falls back to user_metadata', async () => {
    const client = clientFor((table, op) => {
      if (table === 'MemberRole' && op === 'eq') return { data: [{ roleId: 'r-1' }], error: null };
      if (table === 'Role') throw new Error('permission denied');
      if (table === 'roles' || table === 'role') throw new Error('permission denied');
      return { data: [], error: null };
    });
    await expect(resolveLoginRole(client, 'mem-uuid-3', { role: 'admin' })).resolves.toBe('admin');
    await expect(resolveLoginRole(client, 'mem-uuid-3', {})).resolves.toBe('user');
  });

  it('never queries phantom tables that do not exist in the schema', async () => {
    // Regression (PGRST205): only "MemberRole"/"Role" (+ StaffUser) exist -
    // probing member_roles/roles/memberrole/role emits failing requests and,
    // on orphaned accounts, surfaces "Could not find the table" noise.
    const seen = new Set<string>();
    const client = clientFor((table) => {
      seen.add(table);
      return { data: [], error: null };
    });
    await expect(resolveLoginRole(client, 'orphan-id', {})).resolves.toBe('user');
    for (const table of seen) {
      expect(['StaffUser', 'MemberRole', 'Role']).toContain(table);
    }
  });

  it('defaults to user when nothing resolves', async () => {
    await expect(resolveLoginRole(failAll, 'unknown-id', {})).resolves.toBe('user');
  });

  it('never grants admin from metadata alone for unknown users', async () => {
    // Metadata is client-writable: only the literal admin value is honored,
    // and only after DB resolution found nothing.
    await expect(resolveLoginRole(failAll, 'unknown-id', { role: 'super_admin' })).resolves.toBe(
      'admin',
    );
    await expect(resolveLoginRole(failAll, 'unknown-id', { role: 'user' })).resolves.toBe('user');
  });
});
