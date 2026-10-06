import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customerApplicationSchema, reservationAgreementSchema } from '@afhomes/contracts';
import { setApiAccessTokenForTests } from '../../lib/api/client';
import { getCustomerApplications, getReservationAgreements } from './services';

const id = '00000000-0000-4000-8000-000000000001';
const base = {
  id,
  tier_snapshot: 'GOLD',
  payment_scheme_snapshot: 'spot_cash',
  total_price_snapshot: '312000.00',
  primary_signature_status: 'received',
  secondary_signature_status: null,
  has_secondary_holder: false,
  applicant_name: 'QA Applicant',
  created_by: null,
  created_at: '2026-10-01T00:00:00Z',
  submitted_at: null,
  status: 'draft',
};
beforeEach(() => setApiAccessTokenForTests('disposable-test-token'));
afterEach(() => {
  vi.unstubAllGlobals();
  setApiAccessTokenForTests(undefined);
});
const respond = (row: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [row], meta: { total: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );

describe('real summary response contract regression', () => {
  it('loads existing application summary rows that the old detail contract rejected', async () => {
    const row = {
      ...base,
      application_number: 'APP-QA-1',
      customer_id: id,
      plan_id: id,
      valid_id_received: true,
    };
    expect(customerApplicationSchema.safeParse(row).success).toBe(false);
    respond(row);
    expect(await getCustomerApplications({ search: 'APP-QA' })).toEqual([
      {
        id,
        applicationNumber: 'APP-QA-1',
        tier: 'GOLD',
        applicantName: 'QA Applicant',
        createdBy: null,
        createdAt: base.created_at,
        submittedAt: null,
        status: 'draft',
      },
    ]);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('search=APP-QA');
  });
  it('loads existing IST summaries independently, without requiring holder/schedule details', async () => {
    const row = { ...base, reservation_number: 'IST-QA-1', sale_id: id, applicant_name: null };
    expect(reservationAgreementSchema.safeParse(row).success).toBe(false);
    respond(row);
    expect(await getReservationAgreements()).toEqual([
      {
        id,
        reservationNumber: 'IST-QA-1',
        paymentScheme: 'spot_cash',
        totalPrice: '312000.00',
        primarySignatureStatus: 'received',
        secondarySignatureStatus: null,
        hasSecondaryHolder: false,
        saleId: id,
        tier: 'GOLD',
        applicantName: null,
        createdBy: null,
        createdAt: base.created_at,
        submittedAt: null,
        status: 'draft',
      },
    ]);
  });
  it('continues rejecting malformed enums instead of hiding records as empty', async () => {
    respond({ ...base, reservation_number: 'IST-QA-1', sale_id: id, status: 'invented' });
    await expect(getReservationAgreements()).rejects.toThrow();
  });
});
