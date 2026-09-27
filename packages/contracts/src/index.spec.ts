import { describe, expect, it } from 'vitest';

import {
  afHomesDepartmentSchema,
  afHomesModuleKeySchema,
  afHomesPermissionSchema,
  afHomesRoleSchema,
  afHomesSessionSchema,
  afHomesStaffSchema,
  createAfHomesRoleSchema,
  errorEnvelopeSchema,
  exactDecimalRateSchema,
  exactDecimalStringSchema,
  inviteAfHomesStaffSchema,
  listResponseSchema,
} from './index';

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';

const viewAll = { canView: true, canCreate: true, canUpdate: true, canDelete: true };

describe('errorEnvelopeSchema', () => {
  it('accepts a valid envelope', () => {
    expect(
      errorEnvelopeSchema.safeParse({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permission',
          requestId: 'req-123',
          timestamp: 'now',
        },
      }).success,
    ).toBe(true);
  });

  it('rejects a missing request id', () => {
    expect(
      errorEnvelopeSchema.safeParse({
        error: { code: 'FORBIDDEN', message: 'Insufficient permission', timestamp: 'now' },
      }).success,
    ).toBe(false);
  });

  it('rejects a missing message', () => {
    expect(
      errorEnvelopeSchema.safeParse({ error: { code: 'FORBIDDEN', timestamp: 'now' } }).success,
    ).toBe(false);
  });
});

describe('listResponseSchema', () => {
  it('accepts a data array with optional meta', () => {
    const schema = listResponseSchema(afHomesDepartmentSchema);
    expect(schema.safeParse({ data: [] }).success).toBe(true);
    expect(schema.safeParse({ data: [], meta: { total: 0 } }).success).toBe(true);
  });

  it('rejects an invalid item in data', () => {
    const schema = listResponseSchema(afHomesDepartmentSchema);
    expect(schema.safeParse({ data: [{ id: 'not-a-uuid' }] }).success).toBe(false);
  });
});

describe('exact decimal money', () => {
  it('accepts up to two decimal places and rejects floats/negatives', () => {
    for (const ok of ['0', '0.00', '60000', '60000.00', '1234.5']) {
      expect(exactDecimalStringSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['-1', '1.234', '1,000.00', ' 1.00', '1.00 ', 'PHP 1']) {
      expect(exactDecimalStringSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('accepts up to four decimal places for rates', () => {
    expect(exactDecimalRateSchema.safeParse('0.0400').success).toBe(true);
    expect(exactDecimalRateSchema.safeParse('0.04000').success).toBe(false);
  });
});

describe('afHomesModuleKeySchema', () => {
  it('exposes exactly the 24 module keys: the 22 Phase 1 keys plus the 2 Phase 2 additions', () => {
    expect(afHomesModuleKeySchema.options).toHaveLength(24);
    const keys = afHomesModuleKeySchema.options as readonly string[];
    // Phase 2 reused every existing key it could and added only these two.
    expect(keys).toContain('sales.uplines');
    expect(keys).toContain('finance.points');
  });

  it('covers every seeded module group', () => {
    const keys = afHomesModuleKeySchema.options as readonly string[];
    for (const group of [
      'dashboard.',
      'organization.',
      'sales.',
      'finance.',
      'network.',
      'operations.',
      'governance.',
    ]) {
      expect(keys.some((k) => k.startsWith(group)), group).toBe(true);
    }
  });

  it('rejects an unknown module key', () => {
    expect(afHomesModuleKeySchema.safeParse('members.view').success).toBe(false);
  });
});

describe('afHomesPermissionSchema', () => {
  it('accepts a full grant', () => {
    expect(
      afHomesPermissionSchema.safeParse({ moduleKey: 'sales.card_sales', ...viewAll }).success,
    ).toBe(true);
  });

  it('rejects a non-boolean flag', () => {
    expect(
      afHomesPermissionSchema.safeParse({
        moduleKey: 'sales.card_sales',
        canView: 'yes',
        canCreate: false,
        canUpdate: false,
        canDelete: false,
      }).success,
    ).toBe(false);
  });
});

describe('afHomesSessionSchema', () => {
  const session = {
    id: UUID_A,
    email: 'owner@example.com',
    fullName: 'Owner',
    status: 'active',
    roleId: UUID_B,
    roleSlug: 'admin',
    roleName: 'Admin',
    permissions: [{ moduleKey: 'dashboard.view', ...viewAll }],
  };

  it('accepts the server-resolved principal', () => {
    expect(afHomesSessionSchema.safeParse(session).success).toBe(true);
  });

  it('rejects an unknown staff status', () => {
    expect(afHomesSessionSchema.safeParse({ ...session, status: 'pending' }).success).toBe(false);
  });

  it('rejects a session with no role assignment', () => {
    const { roleId: _dropped, ...noRole } = session;
    expect(afHomesSessionSchema.safeParse(noRole).success).toBe(false);
  });
});

describe('afHomesRoleSchema', () => {
  const role = {
    id: UUID_A,
    slug: 'sales_manager',
    name: 'Sales Manager',
    description: null,
    isSystem: false,
    isActive: true,
    assignedCount: 2,
    permissions: [{ moduleKey: 'sales.card_sales', ...viewAll }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts a custom role with permissions', () => {
    expect(afHomesRoleSchema.safeParse(role).success).toBe(true);
  });

  it('rejects a negative assignedCount', () => {
    expect(afHomesRoleSchema.safeParse({ ...role, assignedCount: -1 }).success).toBe(false);
  });
});

describe('afHomesStaffSchema', () => {
  const staff = {
    id: UUID_A,
    email: 'staff@example.com',
    fullName: 'Staff Member',
    status: 'active',
    departmentId: null,
    departmentName: null,
    roleId: UUID_B,
    roleName: 'Admin',
    restrictions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts an unassigned staff member', () => {
    expect(afHomesStaffSchema.safeParse(staff).success).toBe(true);
  });

  it('rejects a bad email', () => {
    expect(afHomesStaffSchema.safeParse({ ...staff, email: 'nope' }).success).toBe(false);
  });
});

describe('createAfHomesRoleSchema', () => {
  it('defaults isActive to true', () => {
    const parsed = createAfHomesRoleSchema.safeParse({
      name: 'Finance Reviewer',
      permissions: [{ moduleKey: 'finance.payment_verification', ...viewAll }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.isActive).toBe(true);
  });

  it('rejects a too-short name and an empty permission set', () => {
    expect(createAfHomesRoleSchema.safeParse({ name: 'A', permissions: [] }).success).toBe(false);
    expect(
      createAfHomesRoleSchema.safeParse({ name: 'Valid Name', permissions: [] }).success,
    ).toBe(true);
  });
});

describe('inviteAfHomesStaffSchema', () => {
  it('accepts an invitation with a nullable department', () => {
    expect(
      inviteAfHomesStaffSchema.safeParse({
        email: 'new@example.com',
        fullName: 'New Hire',
        departmentId: null,
        roleId: UUID_B,
      }).success,
    ).toBe(true);
  });

  it('rejects a malformed email or a non-uuid role', () => {
    const base = { fullName: 'New Hire', departmentId: null, roleId: UUID_B };
    expect(inviteAfHomesStaffSchema.safeParse({ ...base, email: 'bad' }).success).toBe(false);
    expect(inviteAfHomesStaffSchema.safeParse({ ...base, email: 'a@b.co', roleId: 'x' }).success)
      .toBe(false);
  });
});
