/**
 * Client-side submit normalization mirrors the server schemas.
 */
import { describe, expect, it } from 'vitest';

import {
  filterGovernmentIdInput,
  filterLandlineInput,
  filterMemberTinInput,
  filterMobileInput,
  formatTinInput,
  normalizeCustomerApplicationRequest,
  normalizeCustomerRequest,
  normalizeProfileName,
  normalizeReservationAgreementRequest,
  normalizeStaffIdentity,
  normalizeLiveHumanField,
} from './normalize';

describe('live field normalization', () => {
  it.each([
    'line2',
    'permanentAddressLine2',
    'officeBusinessAddress',
    'occupationBusinessName',
    'employedPosition',
  ])('uppercases only classified safe field %s without trimming during typing', (field) => {
    expect(normalizeLiveHumanField(field, 'unit 2, 123 rizal st. ')).toBe('UNIT 2, 123 RIZAL ST. ');
  });
  it.each([
    'firstName',
    'name',
    'vipRecommenderName',
    'password',
    'temporaryPassword',
    'OTP',
    'JWT',
    'token',
    'url',
    'uuid',
    'hash',
    'apiKey',
    'sheetUrl',
    'googleSheetId',
    'storagePath',
    'notes',
    'description',
    'revisionNumber',
    'tinNumber',
  ])('preserves excluded field %s exactly', (field) => {
    expect(normalizeLiveHumanField(field, 'MixedCase-aB123/Path ')).toBe('MixedCase-aB123/Path ');
  });

  it.each(['email', 'recommenderEmail'])('lowercases live field %s while typing', (field) => {
    expect(normalizeLiveHumanField(field, 'Claud@Example.COM')).toBe('claud@example.com');
  });

  it('keeps mobiles digit-only at 11', () => {
    expect(filterMobileInput('+639171234567')).toBe('63917123456');
    expect(filterMobileInput('0917-123-4567')).toBe('09171234567');
    expect(filterMobileInput('abc')).toBe('');
  });

  it('blocks letters from landlines but keeps dialing punctuation', () => {
    expect(filterLandlineInput('(02) 8123-4567')).toBe('(02) 8123-4567');
    expect(filterLandlineInput('abc123')).toBe('123');
  });

  it('keeps member TINs digit-only at 9', () => {
    expect(filterMemberTinInput('123-456-789')).toBe('123456789');
    expect(filterMemberTinInput('1234567890')).toBe('123456789');
  });

  it('groups a typed TIN as 123-456-789 and keeps a branch suffix', () => {
    expect(formatTinInput('123456789')).toBe('123-456-789');
    expect(formatTinInput('123-456-789')).toBe('123-456-789');
    expect(formatTinInput('1234')).toBe('123-4');
    expect(formatTinInput('123456789000')).toBe('123-456-789-000');
    expect(formatTinInput('12345678901234567890')).toBe('123-456-789-01234');
    expect(formatTinInput('abc')).toBe('');
  });

  it('keeps government IDs alphanumeric at 16', () => {
    expect(filterGovernmentIdInput('p 123/456!')).toBe('p123456');
    expect(filterGovernmentIdInput('ABCDEFGHIJKLMNOPQRS')).toBe('ABCDEFGHIJKLMNOP');
  });
});

describe('submit normalization', () => {
  it('normalizes staff identity and profile names', () => {
    expect(normalizeStaffIdentity({ email: '  New@Example.COM ', fullName: 'new hire' })).toEqual({
      email: 'new@example.com',
      fullName: 'new hire',
    });
    expect(normalizeProfileName('renamed admin')).toBe('renamed admin');
  });

  it('normalizes a customer request and never touches notes or IDs', () => {
    const normalized = normalizeCustomerRequest({
      firstName: 'claud',
      lastName: 'dela cruz',
      dateOfBirth: '1990-05-04',
      email: 'Claud@Example.COM',
      phone: '09185550101',
      address: {
        line1: '77 katipunan',
        line2: 'unit 2, 123 rizal st.',
        city: 'quezon city',
        province: 'metro manila',
        countryCode: 'PH',
      },
      notes: 'Keep this Note as Typed!',
    });
    expect(normalized).toMatchObject({
      firstName: 'claud',
      lastName: 'dela cruz',
      email: 'claud@example.com',
      phone: '+639185550101',
      notes: 'Keep this Note as Typed!',
    });
    expect(normalized.address.city).toBe('QUEZON CITY');
    expect(normalized.address.line2).toBe('UNIT 2, 123 RIZAL ST.');
  });

  it('normalizes application and reservation holders, keeping technical fields intact', () => {
    const application = normalizeCustomerApplicationRequest({
      customerId: '00000000-0000-4000-8000-000000000001',
      planId: '00000000-0000-4000-8000-000000000002',
      tier: 'GOLD',
      paymentScheme: 'spot_cash',
      primary: {
        holderType: 'PRIMARY',
        lastName: 'jimenez',
        firstName: 'claud',
        birthDate: '1990-05-04',
        permanentAddressLine1: '123 main st',
        cityMunicipality: 'quezon city',
        province: 'metro manila',
        mobile: '09171234567',
        email: 'Claud@Example.COM',
        printedName: 'claud jimenez',
      },
      consentAcknowledged: true,
      acknowledgedAt: '2026-01-01',
      acquisitionChannels: [],
      primarySignatureStatus: 'pending' as const,
      validIdReceived: true,
      reservationPaymentProofReceived: true,
    });
    expect(application.primary.lastName).toBe('Jimenez');
    expect(application.primary.mobile).toBe('+639171234567');
    expect(application.primary.email).toBe('claud@example.com');
    // Official geographic names are reference values, not prose: upper-casing
    // them would store a spelling the authority never published.
    expect(application.primary.cityMunicipality).toBe('quezon city');
    expect(application.primary.province).toBe('metro manila');
    // A typed street line follows the same readability rule as names now.
    expect(application.primary.permanentAddressLine1).toBe('123 Main St');
    // The referral chain names are title-cased like every other name field.
    expect(
      normalizeCustomerApplicationRequest({
        customerId: '00000000-0000-4000-8000-000000000001',
        planId: '00000000-0000-4000-8000-000000000002',
        tier: 'GOLD',
        paymentScheme: 'spot_cash',
        primary: {
          holderType: 'PRIMARY',
          lastName: 'dela cruz',
          firstName: 'juan',
          birthDate: '1990-05-04',
          permanentAddressLine1: '123 main st',
          cityMunicipality: 'quezon city',
          province: 'metro manila',
          mobile: '09171234567',
          email: 'juan@example.com',
          printedName: 'juan dela cruz',
        },
        svdName: 'pedro reyes',
        ssmName: 'maria santos',
        consentAcknowledged: true,
        acknowledgedAt: '2026-01-01',
        acquisitionChannels: [],
        primarySignatureStatus: 'pending' as const,
        validIdReceived: true,
        reservationPaymentProofReceived: true,
      }),
    ).toMatchObject({ svdName: 'Pedro Reyes', ssmName: 'Maria Santos' });

    const reservation = normalizeReservationAgreementRequest({
      saleId: '00000000-0000-4000-8000-000000000003',
      reservationDate: '2026-01-01',
      agreementDate: '2026-01-02',
      scheduleNotes: [],
      primary: {
        holderType: 'PRIMARY',
        name: 'claud jimenez',
        address: '123 main st',
        contactNumber: '09171234567',
        email: 'Claud@Example.COM',
      },
    });
    expect(reservation.primary.name).toBe('claud jimenez');
    expect(reservation.primary.contactNumber).toBe('+639171234567');
  });
});
