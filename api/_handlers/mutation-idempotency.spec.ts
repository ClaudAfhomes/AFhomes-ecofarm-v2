import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  phase2World,
  phase2WorldTokens,
  SALE,
  TOKEN,
  UUID,
  PRODUCT,
  CUSTOMER,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const sales = (await import('./sales.js')).default;
const forms = (await import('./official-forms.js')).default;
const requestId = '99999999-9999-4999-8999-999999999999';
const application = {
  requestId,
  customerId: CUSTOMER.prospect,
  planId: PRODUCT.gold,
  tier: 'GOLD',
  paymentScheme: 'spot_cash',
  consentAcknowledged: false,
  acknowledgedAt: '2026-01-01',
  primarySignatureStatus: 'pending',
  validIdReceived: false,
  reservationPaymentProofReceived: false,
  primary: {
    holderType: 'PRIMARY',
    firstName: 'QA',
    lastName: 'TEST',
    birthDate: '1990-01-01',
    permanentAddressLine1: '1 QA Street',
    cityMunicipality: 'Calamba',
    province: 'Laguna',
    mobile: '09170000001',
    email: 'qa@example.invalid',
    printedName: 'QA TEST',
  },
};
const reservation = {
  requestId,
  saleId: SALE.submitted,
  customerApplicationId: UUID.viewerStaff,
  reservationDate: '2026-01-01',
  agreementDate: '2026-01-01',
  primarySignatureStatus: 'pending',
  primary: {
    holderType: 'PRIMARY',
    name: 'QA TEST',
    address: '1 QA Street',
    contactNumber: '09170000001',
    email: 'qa@example.invalid',
  },
};
const payment = { requestId, amount: '100.00', paymentType: 'installment', method: 'cash' };
const cases = [
  {
    name: 'payment',
    handler: sales,
    path: `${SALE.unpaid}/payments`,
    rpc: 'record_card_payment_once',
    body: payment,
  },
  {
    name: 'application',
    handler: forms,
    path: 'customer-applications',
    rpc: 'create_customer_application_once',
    body: application,
  },
  {
    name: 'reservation',
    handler: forms,
    path: 'reservations',
    rpc: 'reserve_from_customer_application_once',
    body: reservation,
  },
];
beforeEach(() => {
  holder.db = new FakeSupabase({
    tables: phase2World({}),
    tokens: phase2WorldTokens(),
    rpcs: cases.map((c) => ({ fn: c.rpc, result: UUID.viewerStaff })),
  });
});
async function call(test: (typeof cases)[number], body: unknown, token: string = TOKEN.admin) {
  const { res, state } = makeRes();
  await test.handler(makeReq({ method: 'POST', familyPath: test.path, token, body }), res);
  return state;
}
for (const test of cases)
  describe(`${test.name} durable request boundary`, () => {
    it('requires a UUID before calling the database', async () => {
      expect((await call(test, { ...test.body, requestId: undefined })).status).toBe(400);
      expect(holder.db!.calls.some((c) => c.op === 'rpc')).toBe(false);
    });
    it('rejects malformed request identity', async () => {
      expect((await call(test, { ...test.body, requestId: 'not-a-uuid' })).status).toBe(400);
    });
    it('uses the authenticated actor and ignores actor/hash spoofing', async () => {
      expect(
        (await call(test, { ...test.body, actorId: UUID.viewerStaff, payloadHash: 'spoof' }))
          .status,
      ).toBe(201);
      expect(holder.db!.calls.find((c) => c.table === test.rpc)?.arg).toMatchObject({
        p_actor_id: UUID.adminStaff,
        p_request_id: requestId,
      });
      expect(
        holder.db!.calls.filter((c) => c.op === 'insert' && c.table === 'audit_events'),
      ).toHaveLength(0);
    });
    it('maps changed payload to the required controlled 409', async () => {
      holder.db!.rpcErrors[test.rpc] = { code: 'P0001', message: 'MUTATION_PAYLOAD_CONFLICT' };
      const response = await call(test, test.body);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        error: {
          code: 'CONFLICT',
          message: 'This request identifier was already used with different data.',
        },
      });
    });
    it('keeps effective permission checks mandatory', async () => {
      expect((await call(test, test.body, TOKEN.viewer)).status).toBe(403);
      expect(holder.db!.calls.some((c) => c.table === test.rpc)).toBe(false);
    });
  });
it('retains legacy nonblank-reference payment support without a token', async () => {
  holder.db!.rpcs.push({ fn: 'record_card_payment', result: UUID.viewerStaff });
  expect(
    (await call(cases[0]!, { ...payment, requestId: undefined, reference: 'QA-REFERENCE' })).status,
  ).toBe(201);
});
