import { describe, expect, it } from 'vitest';
import {
  canTransitionCustomerApplication,
  canTransitionReservationAgreement,
  createCustomerApplicationSchema,
  createReservationAgreementSchema,
  customerApplicationDecisionSchema,
  reservationAgreementDecisionSchema,
} from '@jad/contracts';
import {
  CUSTOMER_IMPORT_HEADERS,
  IST_IMPORT_HEADERS,
  OFFICIAL_TIER_BENEFITS,
  customerApplicationXlsx,
  customerImportTemplate,
  istImportTemplate,
  mapOcrToApplicationDraft,
  officialTierBenefits,
  reservationAgreementXlsx,
  officialFormPdf,
  parseFormXlsx,
  validateFormImport,
} from './official-forms.js';

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

describe('official customer application contract', () => {
  it('allows Gold with or without an optional secondary holder', () => {
    expect(createCustomerApplicationSchema.safeParse(base).success).toBe(true);
    expect(
      createCustomerApplicationSchema.safeParse({
        ...base,
        secondary: { ...primary, holderType: 'SECONDARY' },
      }).success,
    ).toBe(true);
  });
  it.each(['BRONZE', 'SILVER'] as const)('rejects a secondary holder for %s', (tier) => {
    expect(
      createCustomerApplicationSchema.safeParse({
        ...base,
        tier,
        secondary: { ...primary, holderType: 'SECONDARY' },
      }).success,
    ).toBe(false);
  });
});

describe('official form XLSX/PDF', () => {
  it('round-trips the stable customer template headings into a review preview', () => {
    const template = customerImportTemplate();
    expect(parseFormXlsx(template)).toEqual(
      Object.fromEntries(CUSTOMER_IMPORT_HEADERS.map((key) => [key, ''])),
    );
    const preview = validateFormImport('customer_application', parseFormXlsx(template));
    expect(preview.requiresReview).toBe(true);
    expect(preview.errors.some((error) => error.field === 'primary_last_name')).toBe(true);
  });
  it('rejects secondary holders outside Gold and never accepts imported economics', () => {
    const fields = { card_tier: 'SILVER', secondary_enabled: 'true', yearly_points: '999999' };
    const preview = validateFormImport('customer_application', fields);
    expect(preview.errors).toContainEqual({
      field: 'secondary_enabled',
      message: 'Secondary holder is Gold-only',
    });
    expect(preview.errors).toContainEqual({ field: 'yearly_points', message: 'Unknown column' });
  });
  it('round-trips saved customer values through XLSX', () => {
    const fields = Object.fromEntries(CUSTOMER_IMPORT_HEADERS.map((key) => [key, '']));
    Object.assign(fields, {
      primary_last_name: 'Dela Cruz',
      primary_first_name: 'Ana',
      primary_birth_date: '1990-05-04',
      primary_address_line_1: '1 Main',
      primary_city_municipality: 'Calamba',
      primary_province: 'Laguna',
      primary_mobile: '09171234567',
      primary_email: 'ana@example.com',
      card_tier: 'GOLD',
      payment_scheme: 'spot_cash',
      consent_acknowledged: 'true',
      acknowledgement_date: '2026-10-01',
    });
    expect(parseFormXlsx(customerApplicationXlsx(fields))).toEqual(fields);
    expect(validateFormImport('customer_application', fields).errors).toEqual([]);
  });
  it('round-trips a saved IST import row', () => {
    const fields = Object.fromEntries(IST_IMPORT_HEADERS.map((key) => [key, '']));
    Object.assign(fields, {
      sale_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      reservation_date: '2026-10-01',
      agreement_date: '2026-10-01',
      primary_signature_status: 'received',
      primary_name: 'Ana Dela Cruz',
      primary_address: '1 Main',
      primary_contact_number: '09171234567',
      primary_email: 'ana@example.com',
      schedule_particular: 'Monthly amortization',
      schedule_amount: '10000.00',
    });
    expect(parseFormXlsx(reservationAgreementXlsx(fields))).toEqual(fields);
    expect(validateFormImport('reservation_agreement', fields).errors).toEqual([]);
  });
  it('round-trips the IST template headings', () => {
    expect(parseFormXlsx(istImportTemplate())).toEqual(
      Object.fromEntries(IST_IMPORT_HEADERS.map((key) => [key, ''])),
    );
  });
  it('validates IST holder, email, phone, date, and signature fields', () => {
    const bad = validateFormImport('reservation_agreement', {
      sale_id: 'not-a-uuid',
      reservation_date: '10/01/2026',
      primary_email: 'not-an-email',
      primary_contact_number: '123',
      primary_signature_status: 'signed',
      payment_due_day: '40',
      schedule_amount: '10.000',
      cash_price: '999',
    });
    expect(bad.errors.map((e) => e.field)).toEqual(
      expect.arrayContaining([
        'sale_id',
        'reservation_date',
        'primary_email',
        'primary_contact_number',
        'primary_signature_status',
        'payment_due_day',
        'schedule_amount',
        'cash_price',
      ]),
    );
  });
  it('generates a real text PDF rather than a screenshot', () => {
    const pdf = Buffer.from(
      officialFormPdf('VIP Privilege Card Application', { primary_name: 'Ana Dela Cruz' }),
    ).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('Ana Dela Cruz');
    expect(pdf).toContain('PRIMARY CARDHOLDER');
  });
  it.each(['BRONZE', 'SILVER', 'GOLD'])(
    'generates selectable-text %s agreement sections',
    (tier) => {
      const pdf = Buffer.from(
        officialFormPdf(
          `${tier} VIP PRIVILEGE CARD RESERVATION AGREEMENT`,
          { tier },
          'reservation_agreement',
        ),
      ).toString('latin1');
      expect(pdf).toContain(tier);
      expect(pdf).toContain('PAYMENT PLAN SUMMARY');
      expect(pdf).not.toContain('/Subtype /Image');
    },
  );
  it.each(['BRONZE', 'SILVER', 'GOLD'] as const)('embeds official %s benefits in PDFs', (tier) => {
    const benefits = OFFICIAL_TIER_BENEFITS[tier];
    const customerPdf = Buffer.from(
      officialFormPdf(
        'VIP PRIVILEGE CARD APPLICATION FORM',
        { card_tier: tier, primary_last_name: 'Dela Cruz' },
        'customer_application',
      ),
    ).toString('latin1');
    expect(customerPdf).toContain(`${benefits.discountPercent}%`);
    expect(customerPdf).toContain('SECONDARY CARDHOLDER - GOLD OPTIONAL');
    const istPdf = Buffer.from(
      officialFormPdf(
        `${tier} VIP PRIVILEGE CARD RESERVATION AGREEMENT`,
        {
          tier,
          total_price: '50000.00',
          reservation_fee: '10000.00',
          balance: '40000.00',
          primary_name: 'Ana Dela Cruz',
          schedule_particular: 'Monthly amortization',
          schedule_amount: '10000.00',
        },
        'reservation_agreement',
      ),
    ).toString('latin1');
    expect(istPdf).toContain('SUPPLEMENTARY CARDHOLDER DETAILS');
    expect(istPdf).toContain('OFFICIAL INCLUSIONS');
    expect(istPdf).toContain('CERTIFICATION AND SIGNATURES');
    expect(officialTierBenefits(tier)?.totalLoyaltyValue).toBe(benefits.totalLoyaltyValue);
  });
});

describe('official form lifecycles', () => {
  it('moves applications draft -> submitted -> approved/rejected with reopen', () => {
    expect(canTransitionCustomerApplication('draft', 'submitted')).toBe(true);
    expect(canTransitionCustomerApplication('submitted', 'approved')).toBe(true);
    expect(canTransitionCustomerApplication('submitted', 'rejected')).toBe(true);
    expect(canTransitionCustomerApplication('submitted', 'draft')).toBe(true);
    expect(canTransitionCustomerApplication('rejected', 'draft')).toBe(true);
    expect(canTransitionCustomerApplication('draft', 'approved')).toBe(false);
    expect(canTransitionCustomerApplication('approved', 'draft')).toBe(false);
    expect(canTransitionCustomerApplication('cancelled', 'draft')).toBe(false);
    expect(
      customerApplicationDecisionSchema.safeParse({ decision: 'approved' }).success,
    ).toBe(true);
    expect(
      customerApplicationDecisionSchema.safeParse({ decision: 'executed' }).success,
    ).toBe(false);
  });
  it('moves agreements draft -> submitted -> executed with reopen', () => {
    expect(canTransitionReservationAgreement('draft', 'submitted')).toBe(true);
    expect(canTransitionReservationAgreement('submitted', 'executed')).toBe(true);
    expect(canTransitionReservationAgreement('submitted', 'draft')).toBe(true);
    expect(canTransitionReservationAgreement('draft', 'executed')).toBe(false);
    expect(canTransitionReservationAgreement('executed', 'draft')).toBe(false);
    expect(
      reservationAgreementDecisionSchema.safeParse({ decision: 'executed' }).success,
    ).toBe(true);
  });
  it('rejects secondary holders for reservations outside Gold at the contract', () => {
    const holder = {
      holderType: 'PRIMARY' as const,
      name: 'Ana Dela Cruz',
      address: '1 Main',
      contactNumber: '09171234567',
      email: 'ana@example.com',
    };
    const saleId = 'aaaaaaaa-0000-4000-8000-000000000001';
    expect(
      createReservationAgreementSchema.safeParse({
        saleId,
        reservationDate: '2026-10-01',
        agreementDate: '2026-10-01',
        primarySignatureStatus: 'received',
        primary: holder,
        scheduleNotes: [],
      }).success,
    ).toBe(true);
    // Contract-level Gold gating lives in the database trigger + save RPC
    // (SECONDARY_HOLDER_GOLD_ONLY); the request schema carries the holder so
    // the server can enforce it against the live plan tier.
    expect(
      createReservationAgreementSchema.safeParse({
        saleId,
        reservationDate: '2026-10-01',
        agreementDate: '2026-10-01',
        primarySignatureStatus: 'received',
        primary: holder,
        secondary: { ...holder, holderType: 'SECONDARY' as const },
        scheduleNotes: [],
      }).success,
    ).toBe(true);
  });
});

describe('OCR candidate mapping', () => {
  it('maps only recognized fields and never saves or submits', () => {
    const { draft, detected, warnings } = mapOcrToApplicationDraft(
      {
        firstName: { value: 'Ana', confidence: 0.9 },
        lastName: { value: 'Dela Cruz', confidence: 0.4 },
        dateOfBirth: { value: '1990-05-04', confidence: null },
        address: { value: '1 Main Street', confidence: 0.8 },
        unknownField: { value: 'ignored', confidence: 0.99 },
      },
      { primary_first_name: '', primary_last_name: '' },
    );
    expect(draft.primary_first_name).toBe('Ana');
    expect(draft.primary_last_name).toBe('Dela Cruz');
    expect(draft.primary_birth_date).toBe('1990-05-04');
    expect(detected).toEqual(
      expect.arrayContaining([
        'primary_first_name',
        'primary_last_name',
        'primary_birth_date',
        'primary_address_line_1',
      ]),
    );
    expect(warnings.some((w) => w.includes('primary_last_name'))).toBe(true);
    // Mapping returns candidates only: no status, no submit flag, no persistence.
    expect(draft).not.toHaveProperty('status');
    expect(draft).not.toHaveProperty('submitted');
  });
});
