import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetStaffStore, staffStore } from '../../../mock/staffMockStore';
import { installMockApi } from '../../../test/utils';
import { getAudit } from '../../audit/services/audit';
import { createRole, deleteRole, updateRole } from './roles';

const ACTOR = { actor: 'Saul Super', actorRole: 'SUPER_ADMIN' };

describe('roles service', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetStaffStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('creates a custom role and appends a ROLE_CREATED audit entry', async () => {
    const role = await createRole({
      name: 'Finance Reviewer',
      permissions: ['dashboard', 'sales'],
      ...ACTOR,
    });
    expect(role.id).toBe('role-finance-reviewer');
    expect(role.isSystem).toBe(false);

    const audit = await getAudit();
    const entry = audit.find((e) => e.action === 'ROLE_CREATED');
    expect(entry).toMatchObject({
      actor: 'Saul Super',
      actorRole: 'SUPER_ADMIN',
      targetType: 'Role',
      targetId: 'role-finance-reviewer',
      targetName: 'Finance Reviewer',
    });
    expect(entry!.detail).toContain('Dashboard');
    expect(entry!.createdAt).toBeTruthy();
  });

  it('rejects duplicate names and empty permission sets', async () => {
    await expect(createRole({ name: 'Admin', permissions: ['sales'], ...ACTOR })).rejects.toThrow(
      'A role with this name already exists.',
    );
    await expect(createRole({ name: 'Empty', permissions: [], ...ACTOR })).rejects.toThrow(
      'A role must grant at least one module.',
    );
  });

  it('records renames and permission diffs on update', async () => {
    const created = await createRole({
      name: 'Finance Reviewer',
      permissions: ['dashboard', 'sales'],
      ...ACTOR,
    });
    const updated = await updateRole({
      id: created.id,
      name: 'Finance Observer',
      permissions: ['dashboard', 'sales', 'withdrawals'],
      ...ACTOR,
    });
    expect(updated.name).toBe('Finance Observer');

    const audit = await getAudit();
    const entry = audit.find((e) => e.action === 'ROLE_PERMISSIONS_UPDATED');
    expect(entry!.detail).toContain('renamed from Finance Reviewer to Finance Observer');
    expect(entry!.detail).toContain('Withdrawals');
  });

  it('blocks revoking the last governance grant at the service layer', async () => {
    await expect(
      updateRole({
        id: 'super_admin',
        permissions: ['dashboard', 'sales'],
        ...ACTOR,
      }),
    ).rejects.toThrow(/last role granting/);
  });

  it('blocks deletion while members hold the role', async () => {
    const created = await createRole({ name: 'Temp', permissions: ['sales'], ...ACTOR });
    staffStore.members.push({
      id: 'stf-100',
      name: 'Temp Holder',
      email: 'temp.holder@jad.example',
      roleId: created.id,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      createdBy: 'Saul Super',
    });
    await expect(deleteRole({ id: created.id, ...ACTOR })).rejects.toThrow(/Reassign them first/);
  });

  it('deletes an unused custom role and appends ROLE_DELETED', async () => {
    const created = await createRole({ name: 'Temp', permissions: ['sales'], ...ACTOR });
    await deleteRole({ id: created.id, ...ACTOR });
    expect(staffStore.roles.some((r) => r.id === created.id)).toBe(false);

    const audit = await getAudit();
    expect(audit.find((e) => e.action === 'ROLE_DELETED')).toMatchObject({
      targetId: created.id,
      targetName: 'Temp',
    });
  });

  it('blocks non-super-admin actors from deleting roles', async () => {
    const created = await createRole({ name: 'Temp', permissions: ['sales'], ...ACTOR });
    await expect(
      deleteRole({ id: created.id, actor: 'Ada Admin', actorRole: 'ADMIN' }),
    ).rejects.toThrow('Only super admins can delete roles.');
    expect(staffStore.roles.some((r) => r.id === created.id)).toBe(true);
  });

  it('lets a super admin delete a system role once unheld and non-governing', async () => {
    await expect(deleteRole({ id: 'merchant', ...ACTOR })).rejects.toThrow(/Reassign them first/);
  });
});
