import { describe, it, expect } from 'vitest';
import { WORKFLOW_COLUMNS } from '@afhomes/contracts';
import {
  buildImportedCustomerFacts,
  buildImportRecoveryPreview,
  legacyPaymentClaims,
} from './customer-import-continuation.js';

const fields = {
  first_name: 'Synthetic',
  last_name: 'Customer',
  email: 'synthetic@example.invalid',
  mobile: '09123456789',
  birth_date: '1990-02-03',
  sex: 'Male',
  citizenship: 'Filipino',
  civil_status: 'Single',
  address_line_1: 'Synthetic Street',
  province: 'Laguna',
  city: 'Calamba',
  barangay: 'Synthetic Barangay',
  landline: '0491234567',
  vip_tier: 'GOLD',
  stated_status: 'Reservation Paid',
  stated_payment_scheme: 'Move a',
  stated_regular_price: '312000',
  stated_discount: '0',
  stated_total: '312000',
  stated_rf: '10000',
  occupation: 'Synthetic business',
  business_address: 'Synthetic office',
  position: 'Manager',
  tin: '123-456-789',
  vd_name: 'Synthetic VD',
  ssm_name: 'Synthetic SSM',
  sm_name: 'Synthetic SM',
  referrer_name: 'Synthetic OST',
  recommender_name: 'Synthetic VIP',
  recommender_contact: '09123456789',
  recommender_email: 'vip@example.invalid',
  secondary_first_name: 'Second',
  secondary_middle_name: 'Synthetic',
  secondary_last_name: 'Customer',
  secondary_birth_date: '1991-03-04',
  secondary_sex: 'Female',
  secondary_citizenship: 'Filipino',
  secondary_address_line_1: 'Other street',
  secondary_province: 'Laguna',
  secondary_city: 'Calamba',
  secondary_mobile: '09987654321',
  secondary_email: 'second@example.invalid',
};
describe('import canonical facts and safe recovery', () => {
  it('extracts a legacy reservation claim only with an explicit paid status and complete receipt facts', () => {
    const source = {
      ...fields,
      stated_status: 'Reservation Paid',
      stated_date: '2026-10-16',
      stated_payment_method: 'Cash',
      stated_reference: 'SYNTHETIC RECEIPT',
    };
    expect(legacyPaymentClaims(source)).toMatchObject([
      {
        purpose: 'reservation',
        amount: '10000.00',
        date: '2026-10-16',
        method: 'cash',
        reference: 'SYNTHETIC RECEIPT',
      },
    ]);
    expect(legacyPaymentClaims({ ...source, stated_reference: '' })).toEqual([]);
    expect(legacyPaymentClaims({ ...source, stated_status: 'Fully Paid' })).toEqual([]);
    expect(legacyPaymentClaims({ ...source, stated_rf: '10.001' })).toEqual([]);
  });
  it('maps company workbook aliases into complete canonical customer and holder facts', () => {
    const result = buildImportedCustomerFacts(fields);
    expect(result.person).toMatchObject({
      email: 'synthetic@example.invalid',
      landline: '0491234567',
      address: {
        line1: 'Synthetic Street',
        province: 'Laguna',
        city: 'Calamba',
        barangay: 'Synthetic Barangay',
        countryCode: 'PH',
      },
    });
    expect(result.company).toMatchObject({
      companyStatus: 'Reservation Paid',
      citizenship: 'Filipino',
      tinNumber: '123-456-789',
      occupationBusinessName: expect.any(String),
      officeBusinessAddress: expect.any(String),
      employedPosition: expect.any(String),
      svdName: 'Synthetic VD',
      vipRecommenderName: 'Synthetic VIP',
      relatedContactNo: '09123456789',
      relatedEmail: 'vip@example.invalid',
      statedVipPackage: 'GOLD',
      statedPaymentTerms: 'Move a',
      statedTotalAmount: '312000',
      statedRf: '10000',
      supplementaryFullName: expect.stringMatching(/Second Synthetic Customer/i),
      supplementaryBirthday: '1991-03-04',
    });
    expect(result.primary).toMatchObject({
      birthDate: '1990-02-03',
      province: 'Laguna',
      cityMunicipality: 'Calamba',
      tinNumber: '123-456-789',
    });
    expect(result.secondary).toMatchObject({ birthDate: '1991-03-04', mobile: '+639987654321' });
    expect(result).not.toHaveProperty('payment');
    expect(result.person).not.toHaveProperty('age');
  });
  it('keeps calculated and private source fields out of untyped customer mapping', () => {
    const result = buildImportedCustomerFacts({
      ...fields,
      claimed_balance: '302000',
      actor_id: 'invented',
      verified: 'true',
      recorded_at: '1900-01-01',
    });
    expect(result.company).not.toHaveProperty('actor_id');
    expect(result.person).not.toHaveProperty('verified');
  });
  it('preserves newer customer edits and only proposes absent values', () => {
    const result = buildImportRecoveryPreview(
      { firstName: 'Imported', email: 'source@example.invalid', citizenship: 'Filipino' },
      { firstName: 'Edited', email: 'source@example.invalid', citizenship: null },
    );
    expect(result.fill).toEqual({ citizenship: 'Filipino' });
    expect(result.conflicts).toEqual([
      { field: 'firstName', message: expect.stringMatching(/current/i) },
    ]);
  });
  it('does not erase existing values or treat false and zero as missing', () => {
    const result = buildImportRecoveryPreview(
      { name: '', status: '', consent: 'true', count: '3' },
      { name: 'Existing', status: 'active', consent: false, count: 0 },
    );
    expect(result.fill).toEqual({});
    expect(result.conflicts.map((c) => c.field)).toEqual(['consent', 'count']);
  });
  it('defines a disposition and destination for each supported workbook column', () => {
    for (const columns of Object.values(WORKFLOW_COLUMNS)) {
      expect(new Set(columns.map((c) => c.key)).size).toBe(columns.length);
      expect(new Set(columns.map((c) => c.header)).size).toBe(columns.length);
      for (const column of columns) expect(column.destinations.length).toBeGreaterThan(0);
    }
  });
});
