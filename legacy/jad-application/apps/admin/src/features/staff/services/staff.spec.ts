import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetStaffStore } from '../../../mock/staffMockStore';
import { installMockApi } from '../../../test/utils';
import { getAudit } from '../../audit/services/audit';
import { assignStaffRole, createStaff, deleteStaff, setStaffStatus } from './staff';

const ACTOR = { actor: 'Saul Super', actorRole: 'SUPER_ADMIN' };

describe('staff service', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetStaffStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('creates an ACTIVE staff member and appends STAFF_CREATED with the role', async () => {
    const member = await createStaff({
      name: 'New Hire',
      email: 'new.hire@jad.example',
      roleId: 'finance',
      temporaryPassword: 'TempPass1',
      ...ACTOR,
    });
    expect(member.status).toBe('ACTIVE');
    expect(member.id).toMatch(/^stf-/);

    const audit = await getAudit();
    const entry = audit.find((e) => e.action === 'STAFF_CREATED');
    expect(entry).toMatchObject({
      targetType: 'Staff',
      targetId: member.id,
      targetName: 'New Hire',
    });
    expect(entry!.detail).toContain('Finance');
  });

  it('rejects duplicate emails and unknown roles', async () => {
    await expect(
      createStaff({
        name: 'Dup',
        email: 'ada.admin@jad.example',
        roleId: 'admin',
        temporaryPassword: 'TempPass1',
        ...ACTOR,
      }),
    ).rejects.toThrow('A staff member with this email already exists.');
    await expect(
      createStaff({
        name: 'Ghost',
        email: 'ghost@jad.example',
        roleId: 'role-ghost',
        temporaryPassword: 'TempPass1',
        ...ACTOR,
      }),
    ).rejects.toThrow('Selected role does not exist.');
  });

  it('records previous and new role values on assignment', async () => {
    await assignStaffRole({ id: 'stf-002', roleId: 'finance', ...ACTOR });
    const audit = await getAudit();
    const entry = audit.find((e) => e.action === 'STAFF_ROLE_ASSIGNED');
    expect(entry!.detail).toBe('Changed role from Admin to Finance');
  });

  it('deletes a staff member and appends STAFF_DELETED', async () => {
    await deleteStaff({ id: 'stf-002', ...ACTOR });
    const audit = await getAudit();
    const entry = audit.find((e) => e.action === 'STAFF_DELETED');
    expect(entry).toMatchObject({
      targetType: 'Staff',
      targetId: 'stf-002',
      targetName: 'Ada Admin',
    });
    expect(entry!.detail).toContain('ada.admin@jad.example');
    await expect(deleteStaff({ id: 'stf-002', ...ACTOR })).rejects.toThrow(
      'Staff member not found',
    );
  });

  it('records enable/disable transitions', async () => {
    await setStaffStatus({ id: 'stf-002', status: 'DISABLED', ...ACTOR });
    await setStaffStatus({ id: 'stf-005', status: 'ACTIVE', ...ACTOR });
    const audit = await getAudit();
    expect(audit.find((e) => e.action === 'STAFF_DISABLED')!.targetId).toBe('stf-002');
    expect(audit.find((e) => e.action === 'STAFF_ENABLED')!.targetId).toBe('stf-005');
  });
});
