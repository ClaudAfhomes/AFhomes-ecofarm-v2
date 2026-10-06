import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardQueuesSchema } from '@afhomes/contracts';
import {
  STAFF2,
  TOKEN,
  TOKEN2,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { selectHandler } from '../_lib/router.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const { default: handler } = await import('./queues.js');

function install(overrides: Record<string, Record<string, unknown>[]> = {}) {
  const tables = phase2World({
    card_sale_hierarchy_snapshots: [],
    redemptions: [],
    ost_applications: [],
    ost_members: [],
    final_qualifications: [],
    ...overrides,
  });
  holder.db = new FakeSupabase({ tables, tokens: phase2WorldTokens() });
  return holder.db as FakeSupabase;
}

async function call(token?: string, familyPath = 'dashboard') {
  const { res, state } = makeRes();
  await handler(makeReq({ method: 'GET', familyPath, token }) as never, res as never);
  return state;
}

const application = (id: string, status: string) => ({
  id,
  referral_code_id: 'cccccccc-0000-4000-8000-000000000001',
  sponsor_staff_id: STAFF2.salesManager,
  email: `${id.slice(0, 8)}@example.invalid`,
  phone: '+639170000011',
  first_name: 'A',
  middle_name: null,
  last_name: 'One',
  birth_date: '1990-01-01',
  address: {},
  registration_details: {},
  status,
  review_notes: null,
  reviewed_by: null,
  submitted_at: new Date().toISOString(),
  reviewed_at: null,
});

const member = (id: string, status: string) => ({
  id,
  application_id: null,
  staff_id: id,
  sponsor_staff_id: STAFF2.salesManager,
  ost_number: `OST-${id.slice(0, 4)}`,
  status,
});

beforeEach(() => install());

describe('GET /queues/dashboard (JAD QueueCard parity)', () => {
  it('routes through the queues family without a router change', () => {
    expect(selectHandler('/api/v1/queues/dashboard', {})?.routeKey).toBe('queues/dashboard');
  });

  it('returns all three authorized counts for a fully-permitted caller', async () => {
    install({
      ost_applications: [
        application('aaaaaaaa-0000-4000-8000-000000000001', 'submitted'),
        application('aaaaaaaa-0000-4000-8000-000000000002', 'under_review'),
        application('aaaaaaaa-0000-4000-8000-000000000003', 'changes_requested'),
        application('aaaaaaaa-0000-4000-8000-000000000004', 'approved'),
        application('aaaaaaaa-0000-4000-8000-000000000005', 'rejected'),
        application('aaaaaaaa-0000-4000-8000-000000000006', 'withdrawn'),
      ],
      ost_members: [
        member('10101010-0000-4000-8000-000000000011', 'active'),
        member('10101010-0000-4000-8000-000000000012', 'suspended'),
      ],
    });
    const state = await call(TOKEN.superAdmin);
    expect(state.status).toBe(200);
    const parsed = dashboardQueuesSchema.parse(state.body);
    // Only reviewable applications are pending work; terminal states excluded.
    expect(parsed.ostApplications).toBe(3);
    // Every member row is a registered member; there is no archived state.
    expect(parsed.ostMembers).toBe(2);
    // Fixture sales awaiting verification: submitted + payment_pending +
    // payment_in_progress (payment_verified/active are decided work).
    expect(parsed.paymentVerification).toBe(3);
    expect(Object.keys(parsed).sort()).toEqual([
      'ostApplications',
      'ostMembers',
      'paymentVerification',
    ]);
  });

  it('matches the authoritative finance queue total exactly', async () => {
    const finance = await call(TOKEN2.finance, 'finance');
    expect(finance.status).toBe(200);
    const dashboard = dashboardQueuesSchema.parse((await call(TOKEN2.finance)).body);
    expect(dashboard.paymentVerification).toBe(
      (finance.body as { meta: { total: number } }).meta.total,
    );
  });

  it('returns null - never a zero - for queues the caller may not know', async () => {
    const finance = dashboardQueuesSchema.parse((await call(TOKEN2.finance)).body);
    expect(finance.paymentVerification).not.toBeNull();
    expect(finance.ostMembers).toBeNull();
    expect(finance.ostApplications).toBeNull();
    // A seller holding none of the queue modules learns no depth at all.
    expect(dashboardQueuesSchema.parse((await call(TOKEN2.salesManager)).body)).toEqual({
      ostMembers: null,
      ostApplications: null,
      paymentVerification: null,
    });
  });

  it('denies unauthenticated callers and staff without dashboard.view', async () => {
    expect((await call()).status).toBe(401);
    const db = holder.db as FakeSupabase;
    const bareRole = {
      id: '20202020-0000-4000-8000-000000000099',
      slug: 'noaccess',
      name: 'No Access',
      is_system: false,
      is_active: true,
    };
    db.rows('roles').push(bareRole);
    db.rows('staff_role_assignments').find((row) => row.staff_id === STAFF2.ost)!.role_id =
      bareRole.id;
    expect((await call(TOKEN2.ost)).status).toBe(403);
  });

  it('does not leak database internals on failure', async () => {
    holder.db = new FakeSupabase({
      tables: phase2World({ card_sale_hierarchy_snapshots: [], redemptions: [] }),
      tokens: phase2WorldTokens(),
      errors: { card_sales: { message: 'secret database detail' } },
    });
    const state = await call(TOKEN.superAdmin);
    expect(state.status).toBe(500);
    expect(JSON.stringify(state.body)).not.toContain('secret database detail');
  });
});
