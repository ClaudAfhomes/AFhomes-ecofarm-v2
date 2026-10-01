/**
 * `GET /auth/portals` - cross-portal identity probe.
 *
 * Drives the REAL handler with the REAL token verifier against the fake.
 * The endpoint is read-only and self-scoped: every case resolves the Auth
 * user from the bearer token, so a caller can only ever learn about their
 * own identities. Staff-only, customer-only, OST-only, dual, none, and
 * invalid-token cases are all pinned here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const portals = (await import('./auth-portals.js')).default;

const SM_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const AUTH_CUSTOMER = 'ffffffff-0000-4000-8000-000000000001';
const AUTH_OST = '55555555-5555-4555-8555-555555555555';
const AUTH_DUAL = '66666666-6666-4666-8666-666666666666';
const AUTH_NONE = '77777777-7777-4777-8777-777777777777';
const CUSTOMER_ID = 'cccccccc-0000-4000-8000-000000000001';

type Row = Record<string, unknown>;

function install() {
  holder.db = new FakeSupabase({
    tables: {
      staff_users: [
        { id: SM_ID, email: 'sm@afhomes.test', full_name: 'Sam Manager', status: 'active', must_change_password: false },
        { id: ADMIN_ID, email: 'admin@afhomes.test', full_name: 'Ada Admin', status: 'active', must_change_password: true },
        { id: AUTH_DUAL, email: 'dual@afhomes.test', full_name: 'Dual User', status: 'active', must_change_password: false },
      ],
      staff_role_assignments: [
        { staff_id: SM_ID, role_id: 'r-sm' },
        { staff_id: ADMIN_ID, role_id: 'r-admin' },
        { staff_id: AUTH_DUAL, role_id: 'r-emp' },
      ],
      roles: [
        { id: 'r-sm', slug: 'sales_manager', name: 'Sales Manager', is_active: true },
        { id: 'r-admin', slug: 'admin', name: 'Admin', is_active: true },
        { id: 'r-emp', slug: 'employee', name: 'Employee', is_active: true },
      ],
      customers: [
        { id: CUSTOMER_ID, customer_number: 'CUS-000777', email: 'ana@example.invalid', status: 'active', auth_user_id: AUTH_CUSTOMER },
        { id: 'cccccccc-0000-4000-8000-000000000002', customer_number: 'CUS-000778', email: 'dual@example.invalid', status: 'active', auth_user_id: AUTH_DUAL },
      ],
      ost_members: [
        { id: AUTH_OST, ost_number: 'OST-000007', full_name: 'Ollie Seller', status: 'active' },
      ],
    } as never,
    tokens: {
      'tok-sm': { id: SM_ID, email: 'sm@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      'tok-admin': { id: ADMIN_ID, email: 'admin@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      'tok-customer': { id: AUTH_CUSTOMER, email: 'ana@example.invalid', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      'tok-ost': { id: AUTH_OST, email: 'ost@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      'tok-dual': { id: AUTH_DUAL, email: 'dual@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      'tok-none': { id: AUTH_NONE, email: 'nobody@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
    },
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

async function call(token?: string) {
  const { res, state } = makeRes();
  await portals(
    makeReq({ method: 'GET', familyPath: 'portals', ...(token ? { token } : {}) }) as never,
    res as never,
  );
  return state as { status: number; body: unknown };
}

describe('GET /auth/portals', () => {
  it('reports a staff-only identity with role and flag', async () => {
    install();
    const s = await call('tok-sm');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({
      staff: { roleSlug: 'sales_manager', status: 'active', mustChangePassword: false },
      customer: null,
      ost: null,
    });
  });

  it('reports mustChangePassword for a flagged admin', async () => {
    install();
    const s = await call('tok-admin');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({
      staff: { roleSlug: 'admin', mustChangePassword: true },
      customer: null,
    });
  });

  it('reports a customer-only identity and no staff row', async () => {
    install();
    const s = await call('tok-customer');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ staff: null, customer: { status: 'active' }, ost: null });
  });

  it('reports an OST-only identity', async () => {
    install();
    const s = await call('tok-ost');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({
      staff: null,
      customer: null,
      ost: { status: 'active', ostNumber: 'OST-000007' },
    });
  });

  it('reports both halves of a dual staff+customer identity', async () => {
    install();
    const s = await call('tok-dual');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({
      staff: { roleSlug: 'employee' },
      customer: { status: 'active' },
    });
  });

  it('reports all null for valid Auth with no AF Homes identity', async () => {
    install();
    const s = await call('tok-none');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ staff: null, customer: null, ost: null });
  });

  it('refuses without a token and with an unknown token', async () => {
    install();
    expect((await call()).status).toBe(401);
    expect((await call('tok-bogus')).status).toBe(401);
  });

  it('never leaks another identity: rows carry no PII beyond the caller', async () => {
    install();
    const s = await call('tok-customer');
    const serialised = JSON.stringify(s.body);
    expect(serialised).not.toContain(SM_ID);
    expect(serialised).not.toContain('sm@afhomes.test');
  });
});
