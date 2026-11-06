import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMongoOfficialFormsHandler } from './official-forms.mongo.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { makeReq, makeRes } from './testing/supabase-fake.js';

/**
 * Regression coverage for the "Load imported customer details" button
 * (GET customer-import-prefill/:id). The handler previously recognized only
 * the legacy `company_v1` workbook format, so any customer imported under the
 * current `company_v2` template (WORKFLOW_TEMPLATE_VERSION) got a false
 * NOT_FOUND even though a committed row genuinely existed. It also returned
 * the row's flat workbook fields unprocessed instead of the nested
 * primary/secondary shape the client expects.
 */
let test: Awaited<ReturnType<typeof createTestReplica>>;
let handler: ReturnType<typeof createMongoOfficialFormsHandler>;
const principal = { userId: randomUUID(), roleSlug: 'admin', permissions: [] };

beforeAll(async () => {
  test = await createTestReplica();
  handler = createMongoOfficialFormsHandler(
    test.db,
    test.client,
    (async () => principal) as never,
  );
}, 120_000);
afterAll(async () => {
  await test?.stop();
});

async function getPrefill(customerId: string) {
  const { res, state } = makeRes();
  await handler(
    makeReq({ method: 'GET', familyPath: `customer-import-prefill/${customerId}` }),
    res,
  );
  return state;
}

const flatFields = (overrides: Record<string, string> = {}) => ({
  first_name: 'Ana',
  last_name: 'Reyes',
  birth_date: '1990-01-01',
  address_line_1: '1 Test St',
  province: 'Metro Manila',
  city: 'Quezon City',
  mobile: '09171234567',
  email: 'ana@example.invalid',
  vip_tier: 'GOLD',
  stated_payment_scheme_code: 'spot_cash',
  recommender_name: 'Juan Dela Cruz',
  recommender_contact: '09170000000',
  recommender_email: 'juan@example.invalid',
  sm_name: 'Maria Santos',
  referrer_name: 'Pedro Cruz',
  ...overrides,
});

const insertCommittedRow = (customerId: string, workbookFormat: string, committed = true) =>
  test.db.collection('customer_import_rows').insertOne({
    _id: randomUUID(),
    customer_id: customerId,
    committed_at: committed ? new Date().toISOString() : null,
    raw_data: { ...flatFields(), workbook_format: workbookFormat },
  } as never);

describe('GET official-forms/customer-import-prefill/:id', () => {
  it('finds a committed company_v2 (current template) import and returns the nested primary/secondary shape', async () => {
    const customerId = randomUUID();
    await insertCommittedRow(customerId, 'company_v2');
    const state = await getPrefill(customerId);
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      // applicationHolderSchema.mobile canonicalizes through phoneSchema.
      primary: { firstName: 'Ana', lastName: 'Reyes', mobile: '+639171234567' },
      tier: 'GOLD',
    });
    // Must not leak the raw flat field names - the client parses this
    // against companyApplicationPrefillSchema, which has no first_name key.
    expect(state.body).not.toHaveProperty('first_name');
  });

  it('still finds a legacy committed company_v1 import', async () => {
    const customerId = randomUUID();
    await insertCommittedRow(customerId, 'company_v1');
    const state = await getPrefill(customerId);
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ primary: { firstName: 'Ana', lastName: 'Reyes' } });
  });

  it('returns a clean NOT_FOUND for a customer with no committed workbook import', async () => {
    const state = await getPrefill(randomUUID());
    expect(state.status).toBe(404);
    expect(state.body).toMatchObject({
      error: {
        code: 'NOT_FOUND',
        message: 'No committed company workbook details for this customer',
      },
    });
  });

  it('ignores an uncommitted (draft) row for the same customer', async () => {
    const customerId = randomUUID();
    await insertCommittedRow(customerId, 'company_v2', false);
    const state = await getPrefill(customerId);
    expect(state.status).toBe(404);
  });

  it('ignores rows tagged with an unrecognized workbook format', async () => {
    const customerId = randomUUID();
    await insertCommittedRow(customerId, 'some_other_format');
    const state = await getPrefill(customerId);
    expect(state.status).toBe(404);
  });
});
