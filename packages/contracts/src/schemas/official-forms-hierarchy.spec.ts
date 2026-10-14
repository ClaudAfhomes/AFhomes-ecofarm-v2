import { describe, expect, it } from 'vitest';

import { createCustomerApplicationSchema } from './official-forms.js';

const primary = {
  holderType: 'PRIMARY' as const,
  lastName: 'Dela Cruz',
  firstName: 'Ana',
  birthDate: '1990-05-04',
  permanentAddressLine1: '1 Main Street',
  cityMunicipality: 'Calamba',
  province: 'Laguna',
  mobile: '09171234567',
  email: 'ana@example.com',
  printedName: 'Ana Dela Cruz',
};

const base = {
  customerId: 'aaaaaaaa-0000-4000-8000-000000000001',
  planId: '33333333-3333-4333-8333-333333333333',
  tier: 'GOLD' as const,
  paymentScheme: 'spot_cash' as const,
  primary,
  acquisitionChannels: ['Referral'] as const,
  consentAcknowledged: true as const,
  acknowledgedAt: '2026-10-01',
  primarySignatureStatus: 'received' as const,
  validIdReceived: true,
  reservationPaymentProofReceived: false,
};

const VD = '22222222-2222-4222-8222-222222222222';
const SSM = '33333333-3333-4333-8333-333333333333';
const SM = '44444444-4444-4444-8444-444444444444';

describe('application hierarchy references', () => {
  it('accepts a complete VD -> SSM -> SM chain', () => {
    expect(
      createCustomerApplicationSchema.safeParse({
        ...base,
        vdStaffId: VD,
        ssmStaffId: SSM,
        smStaffId: SM,
      }).success,
    ).toBe(true);
  });

  it('accepts a leading prefix (VD alone, VD + SSM)', () => {
    expect(createCustomerApplicationSchema.safeParse({ ...base, vdStaffId: VD }).success).toBe(
      true,
    );
    expect(
      createCustomerApplicationSchema.safeParse({ ...base, vdStaffId: VD, ssmStaffId: SSM })
        .success,
    ).toBe(true);
  });

  it('accepts a record with no hierarchy at all (legacy free text)', () => {
    expect(
      createCustomerApplicationSchema.safeParse({ ...base, salesManagerName: 'OLD NAME' }).success,
    ).toBe(true);
  });

  it('rejects an SM without its SSM and VD', () => {
    const parsed = createCustomerApplicationSchema.safeParse({ ...base, smStaffId: SM });
    expect(parsed.success).toBe(false);
  });

  it('rejects an SSM without its VD', () => {
    const parsed = createCustomerApplicationSchema.safeParse({ ...base, ssmStaffId: SSM });
    expect(parsed.success).toBe(false);
  });

  it('treats blank ids as absent, never as invalid UUIDs', () => {
    expect(
      createCustomerApplicationSchema.safeParse({ ...base, vdStaffId: '', smStaffId: '' }).success,
    ).toBe(true);
  });

  it('accepts an optional recommender customer id', () => {
    expect(
      createCustomerApplicationSchema.safeParse({
        ...base,
        recommenderCustomerId: 'dddddddd-0000-4000-8000-000000000004',
      }).success,
    ).toBe(true);
  });

  it('accepts a referring OST with its Sales Manager', () => {
    expect(
      createCustomerApplicationSchema.safeParse({
        ...base,
        vdStaffId: VD,
        ssmStaffId: SSM,
        smStaffId: SM,
        referrerOstId: 'eeeeeeee-0000-4000-8000-000000000005',
      }).success,
    ).toBe(true);
  });

  it('rejects a referring OST without its Sales Manager', () => {
    const parsed = createCustomerApplicationSchema.safeParse({
      ...base,
      referrerOstId: 'eeeeeeee-0000-4000-8000-000000000005',
    });
    expect(parsed.success).toBe(false);
  });
});
