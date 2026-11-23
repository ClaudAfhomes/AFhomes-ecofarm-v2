import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER,
  PRODUCT,
  STAFF2,
  TOKEN,
  TOKEN2,
  UUID,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const forms = (await import('./official-forms.js')).default;
const sales = (await import('./sales.js')).default;
const commissions = (await import('./commissions.js')).default;
const APP = '12121212-0000-4000-8000-000000000001';
const REQUEST = '12121212-0000-4000-8000-000000000002';
const primary = {
  holderType: 'PRIMARY',
  firstName: 'Mara',
  lastName: 'Santos',
  birthDate: '1990-01-01',
  permanentAddressLine1: '12 Garden Street',
  province: 'Laguna',
  cityMunicipality: 'Calamba',
  mobile: '09171234567',
  email: 'mara@example.invalid',
  printedName: 'Mara Santos',
};
const application = {
  requestId: REQUEST,
  customerId: CUSTOMER.prospect,
  planId: PRODUCT.gold,
  tier: 'GOLD',
  paymentScheme: 'spot_cash',
  primary,
  consentAcknowledged: true,
  acknowledgedAt: '2026-01-01',
  validIdReceived: false,
  reservationPaymentProofReceived: false,
};
beforeEach(() => {
  holder.db = new FakeSupabase({
    tables: phase2World({
      customer_applications: [{ id: APP, status: 'submitted', created_by: STAFF2.salesManager }],
      customer_application_holders: [],
    }),
    tokens: phase2WorldTokens(),
    rpcs: [
      { fn: 'create_customer_application_once', result: APP },
      { fn: 'decide_purchase_application_once', result: APP },
    ],
  });
});
async function call(handler: typeof forms, path: string, token: string, body: unknown) {
  const { res, state } = makeRes();
  await handler(makeReq({ method: 'POST', familyPath: path, token, body }), res);
  return state;
}
describe('coordinated application and RA authorization', () => {
  it.each([TOKEN2.salesManager, TOKEN.admin, TOKEN.superAdmin])(
    'creates through one atomic RPC for %s',
    async (token) => {
      const result = await call(forms, 'customer-applications', token, {
        ...application,
        ...(token === TOKEN2.salesManager ? {} : { smStaffId: STAFF2.salesManager }),
      });
      expect(result.status).toBe(201);
      expect(
        holder.db.calls.filter(
          (c) => c.op === 'rpc' && c.table === 'create_customer_application_once',
        ),
      ).toHaveLength(1);
      expect(holder.db.calls.filter((c) => ['insert', 'update'].includes(c.op))).toHaveLength(0);
    },
  );
  it.each([
    TOKEN2.seniorSalesManager,
    TOKEN2.viceDirector,
    TOKEN2.ost,
    TOKEN2.finance,
    TOKEN.inactive,
  ])('refuses origination for %s without writes', async (token) => {
    expect((await call(forms, 'customer-applications', token, application)).status).toBe(403);
    expect(
      holder.db.calls.filter(
        (c) => c.op === 'rpc' && c.table === 'create_customer_application_once',
      ),
    ).toHaveLength(0);
  });
  it('requires an administrator to name the SM before creation', async () => {
    expect((await call(forms, 'customer-applications', TOKEN.admin, application)).status).toBe(400);
  });
  it.each([TOKEN.admin, TOKEN.superAdmin])(
    'makes exactly one coordinated approval request for %s',
    async (token) => {
      expect(
        (
          await call(forms, `customer-applications/${APP}/decision`, token, {
            requestId: REQUEST,
            decision: 'approved',
            actorId: STAFF2.finance,
          })
        ).status,
      ).toBe(200);
      const calls = holder.db.calls.filter(
        (c) => c.op === 'rpc' && c.table === 'decide_purchase_application_once',
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.arg).toMatchObject({
        p_actor_id: token === TOKEN.admin ? UUID.adminStaff : UUID.superAdminStaff,
        p_decision: 'approved',
      });
      expect(holder.db.calls.some((c) => c.table === 'transition_purchase_reservation_once')).toBe(
        false,
      );
    },
  );
  it.each([
    TOKEN2.salesManager,
    TOKEN2.seniorSalesManager,
    TOKEN2.viceDirector,
    TOKEN2.ost,
    TOKEN2.finance,
  ])('refuses approval for %s even with an injected approval grant', async (token) => {
    const identity = phase2WorldTokens()[token]!;
    const assignment = holder.db
      .rows('staff_role_assignments')
      .find((row) => row.staff_id === identity.id)!;
    holder.db
      .rows('role_permissions')
      .push({
        role_id: assignment.role_id,
        module_id: 'module:sales.application_approval',
        can_view: true,
        can_update: true,
      });
    expect(
      (
        await call(forms, `customer-applications/${APP}/decision`, token, {
          requestId: REQUEST,
          decision: 'approved',
        })
      ).status,
    ).toBe(403);
    expect(holder.db.calls.some((c) => c.table === 'decide_purchase_application_once')).toBe(false);
  });
  it.each(['SIGNED_APPLICATION_DOCUMENT_REQUIRED', 'SIGNED_RA_DOCUMENT_REQUIRED'])(
    'keeps database prerequisite %s visible',
    async (message) => {
      holder.db.rpcErrors.decide_purchase_application_once = { message, code: '55000' };
      expect(
        (
          await call(forms, `customer-applications/${APP}/decision`, TOKEN.admin, {
            requestId: REQUEST,
            decision: 'approved',
          })
        ).status,
      ).toBe(409);
    },
  );
  it.each([TOKEN.admin, TOKEN.superAdmin, TOKEN2.salesManager])(
    'blocks legacy direct-sale creation for %s',
    async (token) => {
      const before = holder.db.rows('card_sales').length;
      const result = await call(sales, '', token, {
        customerId: CUSTOMER.prospect,
        productId: PRODUCT.gold,
        sellerStaffId: STAFF2.salesManager,
      });
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ error: { code: 'PURCHASE_WORKFLOW_REQUIRED' } });
      expect(holder.db.rows('card_sales')).toHaveLength(before);
      expect(holder.db.calls.some((c) => c.table === 'next_sale_number')).toBe(false);
    },
  );
  it('gives Finance payout recording and reconciliation without qualification or policy authority', async () => {
    holder.db.rpcs.push(
      { fn: 'record_commission_payout_failure', result: APP },
      { fn: 'reconcile_commission_payout', result: APP },
    );
    expect(
      (
        await call(commissions, `${APP}/payouts/fail`, TOKEN2.finance, {
          reason: 'Synthetic failed transfer',
          bankReference: 'SYNTHETIC-FAILED',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call(commissions, `payouts/${APP}/reconcile`, TOKEN2.finance, {
          paidOn: '2026-01-01',
          bankReference: 'SYNTHETIC-REFERENCE',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(commissions, `${APP}/qualify`, TOKEN2.finance, {
          decision: 'earned',
          notes: 'Synthetic qualification',
        })
      ).status,
    ).toBe(403);
    expect((await call(commissions, 'rules', TOKEN2.finance, {})).status).toBe(403);
  });
});
