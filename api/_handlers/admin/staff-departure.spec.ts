/**
 * Head departure: suspending or deactivating a head retires their direct
 * downline edges so the genealogy reads through to the next higher active
 * head (OST -> SM -> SVD when the SSM leaves). The stored upline is kept, so
 * a reinstated head reappears without reassignment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));

vi.mock('../../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const handler = (await import('./afhomes.js')).default;

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SVD_ID = '22222222-2222-4222-8222-222222222222';
const SSM_ID = '33333333-3333-4333-8333-333333333333';
const SM_ID = '44444444-4444-4444-8444-444444444444';
const ADMIN_TOKEN = 'admin-token';

type Row = Record<string, unknown>;

function install() {
  const staff = (id: string, email: string, name: string, roleId: string) => ({
    id,
    email,
    full_name: name,
    status: 'active',
    department_id: null,
    employee_number: null,
    must_change_password: false,
    role_id: roleId,
    role_name: name,
    role_slug: roleId,
    created_at: '2026-09-01T00:00:00.000Z',
  });
  holder.db = new FakeSupabase({
    tables: {
      modules: [{ id: 'm-staff', key: 'organization.staff', is_active: true }],
      roles: [{ id: 'r-admin', slug: 'admin', name: 'Admin', is_active: true }],
      role_permissions: [
        {
          role_id: 'r-admin',
          module_id: 'm-staff',
          can_view: true,
          can_create: true,
          can_update: true,
          can_delete: true,
        },
      ],
      staff_permission_restrictions: [],
      staff_users: [
        staff(ADMIN_ID, 'admin@afhomes.test', 'ADMIN', 'r-admin'),
        staff(SVD_ID, 'vd@afhomes.test', 'VD', 'r-admin'),
        staff(SSM_ID, 'ssm@afhomes.test', 'SSM', 'r-admin'),
        staff(SM_ID, 'sm@afhomes.test', 'SM', 'r-admin'),
      ],
      staff_role_assignments: [
        { staff_id: ADMIN_ID, role_id: 'r-admin' },
        { staff_id: SVD_ID, role_id: 'r-admin' },
        { staff_id: SSM_ID, role_id: 'r-admin' },
        { staff_id: SM_ID, role_id: 'r-admin' },
      ],
      departments: [],
      referral_relationships: [
        {
          subject_staff_id: SSM_ID,
          upline_staff_id: SVD_ID,
          hierarchy_role: 'senior_sales_manager',
          is_active: true,
          is_authoritative: true,
        },
        {
          subject_staff_id: SM_ID,
          upline_staff_id: SSM_ID,
          hierarchy_role: 'sales_manager',
          is_active: true,
          is_authoritative: true,
        },
      ],
      audit_events: [],
    } as never,
    tokens: {
      [ADMIN_TOKEN]: {
        id: ADMIN_ID,
        email: 'admin@afhomes.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
    },
  });
  return holder.db;
}

async function call(options: { method?: string; afPath: string; body?: unknown }) {
  const { res, state } = makeRes();
  await handler(
    makeReq({
      method: options.method ?? 'POST',
      afPath: options.afPath,
      body: options.body,
      token: ADMIN_TOKEN,
    }) as never,
    res as never,
  );
  return state;
}

const edges = () =>
  (holder.db as unknown as { rows: (t: string) => Row[] }).rows('referral_relationships');

beforeEach(() => {
  install();
});

describe('head departure retires downline edges', () => {
  it('suspending a head retires only their direct edges', async () => {
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${SSM_ID}`,
      body: { status: 'suspended' },
    });
    expect(state.status).toBe(200);
    const bySubject = new Map(edges().map((e) => [e.subject_staff_id, e]));
    // SM -> SSM retired; SSM -> SVD (the departing head's own edge) untouched.
    expect(bySubject.get(SM_ID)?.is_active).toBe(false);
    expect(bySubject.get(SSM_ID)?.is_active).toBe(true);
  });

  it('deactivating a head retires their direct edges', async () => {
    const state = await call({ afPath: `staff/${SSM_ID}/deactivate` });
    expect(state.status).toBe(200);
    expect(
      edges().find((e) => e.subject_staff_id === SM_ID)?.is_active,
    ).toBe(false);
  });

  it('leaves edges alone when the status stays active', async () => {
    const state = await call({
      method: 'PATCH',
      afPath: `staff/${SSM_ID}`,
      body: { departmentId: null },
    });
    expect(state.status).toBe(200);
    expect(edges().every((e) => e.is_active === true)).toBe(true);
  });
});
