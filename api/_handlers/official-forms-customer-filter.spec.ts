import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: (
    res: { status: (c: number) => { json: (b: unknown) => void } },
    rows: unknown[],
  ) => res.status(200).json({ data: rows, meta: { total: rows.length } }),
  methodNotAllowed: () => {},
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

vi.mock('../_lib/afhomes-access.js', () => ({
  authorizeAfHomes: async () => ({
    userId: '22222222-2222-4222-8222-222222222222',
    roleSlug: 'super_admin',
  }),
}));

const forms = (await import('./official-forms.js')).default;

const CUSTOMER_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const CUSTOMER_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const APP_A = '11111111-1111-4111-8111-111111111111';
const APP_B = '22222222-2222-4222-8222-222222222222';

type ResState = { status: number; body: { data: { id: string }[] } };

async function listApplications(query: Record<string, string>) {
  const { res, state } = makeRes();
  await (
    forms as unknown as (req: unknown, res: unknown) => Promise<void>
  )(
    makeReq({
      method: 'GET',
      familyPath: 'customer-applications',
      query,
      headers: { authorization: 'Bearer super-admin-token' },
    }) as never,
    res as never,
  );
  return state as ResState;
}

const application = (id: string, customerId: string, createdAt: string) => ({
  id,
  customer_id: customerId,
  status: 'submitted',
  created_at: createdAt,
});

describe('customer applications filtered by customer', () => {
  beforeEach(() => {
    holder.db = new FakeSupabase({
      tables: {
        customer_applications: [
          application(APP_A, CUSTOMER_A, '2026-01-02T00:00:00Z'),
          application(APP_B, CUSTOMER_B, '2026-01-01T00:00:00Z'),
        ],
        customer_application_holders: [],
        reservation_agreements: [],
        reservation_agreement_holders: [],
        reservation_agreement_schedule: [],
        audit_events: [],
      } as never,
    });
  });

  it('returns every application when no customer is asked for', async () => {
    const state = await listApplications({});
    expect(state.body.data.map((row) => row.id).sort()).toEqual([APP_A, APP_B]);
  });

  it("returns only the asked customer's applications", async () => {
    const state = await listApplications({ customerId: CUSTOMER_A });
    expect(state.body.data.map((row) => row.id)).toEqual([APP_A]);
  });

  it('returns nothing for a customer with no applications rather than falling back to the lot', async () => {
    const state = await listApplications({
      customerId: 'cccccccc-0000-4000-8000-00000000000c',
    });
    expect(state.body.data).toEqual([]);
  });

  it('rejects a malformed customerId instead of quietly ignoring it', async () => {
    const state = await listApplications({ customerId: 'not-a-uuid' });
    expect(state.status).toBe(400);
  });
});
