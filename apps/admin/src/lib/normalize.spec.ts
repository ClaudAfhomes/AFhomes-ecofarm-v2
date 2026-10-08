/**
 * Client-side submit normalization mirrors the server schemas.
 */
import { describe, expect, it } from 'vitest';

import {
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
    'email',
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
    expect(application.primary.lastName).toBe('jimenez');
    expect(application.primary.mobile).toBe('+639171234567');
    expect(application.primary.email).toBe('claud@example.com');
    // Official geographic names are reference values, not prose: upper-casing
    // them would store a spelling the authority never published.
    expect(application.primary.cityMunicipality).toBe('quezon city');
    expect(application.primary.province).toBe('metro manila');
    // A typed street line is still user-entered text and still upper-cased.
    expect(application.primary.permanentAddressLine1).toBe('123 MAIN ST');

    const reservation = normalizeReservationAgreementRequest({
      saleId: '00000000-0000-4000-8000-000000000003',
      reservationDate: '2026-01-01',
      agreementDate: '2026-01-02',
      scheduleNotes: [],
      primarySignatureStatus: 'pending' as const,
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
