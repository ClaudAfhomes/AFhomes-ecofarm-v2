import { beforeEach, describe, expect, it, vi } from 'vitest';
import { phase2World, phase2WorldTokens, TOKEN, UUID } from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const forms = (await import('./official-forms.js')).default;
beforeEach(() => {
  holder.db = new FakeSupabase({
    tables: phase2World({}),
    tokens: phase2WorldTokens(),
    rpcs: [{ fn: 'save_customer_application', result: UUID.viewerStaff }],
  });
});
const person = () => ({
  holderType: 'PRIMARY',
  firstName: 'claud',
  lastName: 'jimenez',
  birthDate: '1990-05-04',
  permanentAddressLine1: '123 main st',
  cityMunicipality: 'quezon city',
  province: 'metro manila',
  mobile: '09171234567',
  email: 'qa@example.com',
  printedName: 'claud jimenez',
});
function body(field: string, value: unknown) {
  const primary = {
    ...person(),
    ...(field === 'primary.landline' && value !== undefined ? { landline: value } : {}),
  };
  return {
    customerId: UUID.viewerStaff,
    planId: UUID.viewerStaff,
    tier: 'GOLD',
    paymentScheme: 'spot_cash',
    primary,
    ...(field === 'secondary.landline'
      ? {
          secondary: {
            ...person(),
            holderType: 'SECONDARY',
            ...(value !== undefined ? { landline: value } : {}),
          },
        }
      : {}),
    ...(field === 'recommenderContact' && value !== undefined ? { recommenderContact: value } : {}),
    consentAcknowledged: true,
    acknowledgedAt: '2026-01-01',
    primarySignatureStatus: 'pending',
    validIdReceived: true,
    reservationPaymentProofReceived: true,
  };
}
async function save(field: string, value: unknown, method = 'POST') {
  const { res, state } = makeRes();
  await forms(
    makeReq({
      method,
      familyPath:
        method === 'POST' ? 'customer-applications' : `customer-applications/${UUID.viewerStaff}`,
      token: TOKEN.admin,
      body: body(field, value),
    }),
    res,
  );
  return state;
}
function args() {
  const call = holder.db!.calls.find((c) => c.table === 'save_customer_application');
  return call?.arg;
}
for (const field of ['primary.landline', 'secondary.landline', 'recommenderContact']) {
  describe(field, () => {
    it.each([undefined, '', null, '   '])('accepts absent optional phone %s', async (value) => {
      expect((await save(field, value)).status).toBe(201);
      const a = args();
      expect(a).toBeDefined();
      expect(JSON.stringify(a)).not.toContain(
        field === 'recommenderContact' ? '"recommenderContact"' : '"landline"',
      );
    });
    it.each(['09171234567', '+639171234567', '0917-123-4567'])(
      'normalizes valid %s before save RPC',
      async (value) => {
        expect((await save(field, value)).status).toBe(201);
        const a = args();
        const path = field === 'recommenderContact' ? 'p_header.recommenderContact' : 'p_' + field;
        expect(a).toHaveProperty(path, '+639171234567');
      },
    );
    it.each(['09ABC123456', 'PHONE123', '0917TEST'])(
      'rejects %s before any save RPC',
      async (value) => {
        const state = await save(field, value);
        expect(state.status).toBe(400);
        expect(state.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
        expect(args()).toBeUndefined();
      },
    );
    it('rejects a direct PATCH bypass before save RPC', async () => {
      const state = await save(field, '09ABC123456', 'PATCH');
      expect(state.status).toBe(400);
      expect(args()).toBeUndefined();
    });
  });
}
