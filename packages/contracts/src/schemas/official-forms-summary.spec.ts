import { describe, it, expect } from 'vitest';
import {
  reservationAgreementListItemSchema,
  reservationAgreementSchema,
} from './official-forms.js';
const id = '00000000-0000-4000-8000-000000000001';
const row = {
  id,
  reservation_number: 'RES-QA',
  sale_id: id,
  tier_snapshot: 'GOLD',
  applicant_name: 'QA Applicant',
  created_by: null,
  created_at: '2026-10-01',
  submitted_at: null,
  status: 'draft',
  payment_scheme_snapshot: 'spot_cash',
  total_price_snapshot: '312000.00',
  primary_signature_status: 'received',
  secondary_signature_status: null,
  has_secondary_holder: false,
};
describe('IST summary commercial fields', () => {
  it('exposes exact snapshot values independently from detail-only fields', () => {
    expect(
      reservationAgreementListItemSchema.parse({
        ...row,
        monthly_amortization_start: null,
        secondary: null,
      }),
    ).toMatchObject({
      applicantName: 'QA Applicant',
      paymentScheme: 'spot_cash',
      totalPrice: '312000.00',
      primarySignatureStatus: 'received',
      secondarySignatureStatus: null,
      hasSecondaryHolder: false,
    });
    expect(reservationAgreementSchema.safeParse(row).success).toBe(false);
  });
  it.each(['executed', 'cancelled'])('accepts %s rows and nullable secondary status', (status) => {
    expect(reservationAgreementListItemSchema.parse({ ...row, status }).status).toBe(status);
  });
  it('preserves two-holder Gold signature state', () => {
    expect(
      reservationAgreementListItemSchema.parse({
        ...row,
        has_secondary_holder: true,
        secondary_signature_status: 'received',
      }),
    ).toMatchObject({ hasSecondaryHolder: true, secondarySignatureStatus: 'received' });
  });
  it.each([
    'payment_scheme_snapshot',
    'total_price_snapshot',
    'primary_signature_status',
    'secondary_signature_status',
    'has_secondary_holder',
  ])('requires endpoint field %s instead of hiding mismatches', (field) => {
    const input = { ...row } as Record<string, unknown>;
    delete input[field];
    expect(reservationAgreementListItemSchema.safeParse(input).success).toBe(false);
  });
});
