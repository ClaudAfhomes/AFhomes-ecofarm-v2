import { describe, expect, it } from 'vitest';
import {
  approveOstAccreditationSchema,
  manualOstAccreditationSchema,
  ostAccreditationRecordsSchema,
  ostOfficialFormSchema,
  submitOstAccreditationSchema,
  submitOstRenewalSchema,
  updateOstApplicantSchema,
  ostAnnualExpiry,
  ostRenewalEarliestStart,
} from './ost-accreditation.js';
const form = {
  dateApplied: '2026-01-01',
  programCategory: 'non_vip',
  sex: 'male',
  civilStatus: 'single',
  governmentIdType: 'philippine_id',
  governmentIdNumber: 'SYNTHETIC-ID',
  applicantSignatureStatus: 'received',
  referrerSignatureStatus: 'pending',
  applicantSignedOn: '2026-01-01',
};
const identity = {
  firstName: 'Qa',
  lastName: 'Tester',
  email: 'qa@example.invalid',
  phone: '09171234567',
  birthDate: '1990-01-01',
  address: { line1: 'QA STREET', city: 'QA CITY', province: 'QA PROVINCE', countryCode: 'PH' },
};
const requestId = '00000000-0000-4000-8000-000000000001';
describe('official accreditation boundaries', () => {
  it.each([['2026-10-17', '2027-10-17'], ['2024-02-29', '2025-02-28'], ['2023-02-28', '2024-02-28']])(
    'calculates a calendar year from %s as %s', (start, expected) => {
      expect(ostAnnualExpiry(start)).toBe(expected);
    },
  );
  it('rejects a renewal duration other than one calendar year', () => {
    expect(submitOstRenewalSchema.safeParse({
      requestId, dateOfRenewal: '2026-01-01', requestedStart: '2026-01-02', requestedEnd: '2028-01-02',
      applicantSignatureStatus: 'pending', referrerSignatureStatus: 'pending',
    }).success).toBe(false);
  });
  it('rejects unapproved free-text government ID categories', () => {
    expect(ostOfficialFormSchema.safeParse({ ...form, governmentIdType: 'invented category' }).success).toBe(false);
  });
  it.each(['philippine_id', 'drivers_license', 'passport', 'tax_id', 'other'])(
    'accepts the shared IST government ID category %s', (governmentIdType) => {
      expect(ostOfficialFormSchema.safeParse({ ...form, governmentIdType }).success).toBe(true);
    },
  );
  it('normalizes the same identity for public and manual entry', () => {
    const publicForm = submitOstAccreditationSchema.parse({
      requestId,
      referralCode: 'OST-ABCDEF-123456',
      identity,
      form,
    });
    const manual = manualOstAccreditationSchema.parse({
      requestId,
      sponsorStaffId: requestId,
      identity,
      form,
    });
    expect(manual.identity).toEqual(publicForm.identity);
    expect(manual.identity.firstName).toBe('Qa');
  });
  it('never accepts a public caller-selected sponsor', () =>
    expect(
      submitOstAccreditationSchema.safeParse({
        requestId,
        referralCode: 'OST-ABCDEF-123456',
        sponsorStaffId: requestId,
        identity,
        form,
      }).success,
    ).toBe(false));
  it('requires a real manual sponsor UUID', () =>
    expect(
      manualOstAccreditationSchema.safeParse({ requestId, sponsorStaffId: '', identity, form })
        .success,
    ).toBe(false));
  it('rejects future application dates', () =>
    expect(ostOfficialFormSchema.safeParse({ ...form, dateApplied: '2999-01-01' }).success).toBe(
      false,
    ));
  it('requires a card tier for an existing VIP holder', () =>
    expect(
      ostOfficialFormSchema.safeParse({ ...form, programCategory: 'vip_holder' }).success,
    ).toBe(false));
  it('requires a date for a received signature', () =>
    expect(ostOfficialFormSchema.safeParse({ ...form, applicantSignedOn: null }).success).toBe(
      false,
    ));
  it('rejects signature dates after the form date', () =>
    expect(
      ostOfficialFormSchema.safeParse({ ...form, applicantSignedOn: '2026-01-02' }).success,
    ).toBe(false));
  it('does not accept invented extras in private referrer snapshots', () =>
    expect(
      ostOfficialFormSchema.safeParse({ ...form, referrerSnapshot: { sponsorStaffId: requestId } })
        .success,
    ).toBe(false));
  it('requires explicit management validity rather than a default duration', () =>
    expect(approveOstAccreditationSchema.safeParse({ startsOn: '2026-01-01' }).success).toBe(
      false,
    ));
  it('rejects inverted management dates', () =>
    expect(
      approveOstAccreditationSchema.safeParse({ startsOn: '2026-01-02', expiresOn: '2026-01-01' })
        .success,
    ).toBe(false));
  it('requires an explained sponsor change on renewal', () =>
    expect(
      submitOstRenewalSchema.safeParse({
        requestId,
        dateOfRenewal: '2026-01-01',
        requestedStart: '2026-01-02',
        requestedEnd: '2027-01-02',
        proposedNewSponsorStaffId: requestId,
        applicantSignatureStatus: 'pending',
        referrerSignatureStatus: 'pending',
      }).success,
    ).toBe(false));
  it('does not allow callers to substitute a renewal identity snapshot', () =>
    expect(
      submitOstRenewalSchema.safeParse({
        requestId,
        dateOfRenewal: '2026-01-01',
        requestedStart: '2026-01-02',
        requestedEnd: '2027-01-02',
        applicantSnapshot: identity,
        applicantSignatureStatus: 'pending',
        referrerSignatureStatus: 'pending',
      }).success,
    ).toBe(false));
});

describe('annual renewal policy exposure', () => {
  it.each([
    ['2026-10-17', '2026-10-18'],
    ['2026-12-31', '2027-01-01'],
    ['2024-02-28', '2024-02-29'],
    ['2024-02-29', '2024-03-01'],
  ])('sets the earliest renewal start after prior expiry %s to %s', (expiry, expected) => {
    expect(ostRenewalEarliestStart(expiry)).toBe(expected);
  });
  const snapshot = {
    fullName: 'Qa Tester',
    birthDate: '1990-01-01',
    email: 'qa@example.invalid',
    phone: '09171234567',
    sex: 'male',
    civilStatus: 'single',
    address: { line1: 'QA STREET' },
    messenger: null,
    employerName: null,
    jobPosition: null,
    tinMasked: '***4567',
    programCategory: 'unknown',
    vipCardType: null,
  };
  const record = {
    registration: null,
    currentApplicant: snapshot,
    terms: [
      {
        id: requestId,
        starts_on: '2025-01-01',
        expires_on: '2026-01-01',
        displayStatus: 'expired',
        approved_at: '2025-01-01',
      },
    ],
    renewals: [
      {
        id: requestId,
        renewal_number: 'REN-QA',
        date_of_renewal: '2026-01-01',
        requested_start: '2026-01-02',
        requested_end: '2027-01-02',
        status: 'submitted',
        old_sponsor_staff_id: requestId,
        proposed_new_sponsor_staff_id: null,
        reason_for_referrer_change: null,
        endorsed_at: null,
        review_notes: null,
        applicant_signature_status: 'pending',
        referrer_signature_status: 'pending',
        applicant_snapshot: snapshot,
        original_accreditation_date: '2025-01-01',
        last_expiry_date: '2026-01-01',
        referrer_snapshot: { staffId: requestId, name: 'Sam Manager', email: 'sm@example.invalid' },
      },
    ],
  };
  it('accepts records with current and frozen applicant snapshots', () => {
    expect(ostAccreditationRecordsSchema.safeParse(record).success).toBe(true);
  });
  it('never accepts a non-authoritative VIP category', () => {
    expect(
      ostAccreditationRecordsSchema.safeParse({
        ...record,
        currentApplicant: { ...snapshot, programCategory: 'invented' },
      }).success,
    ).toBe(false);
  });
});

describe('controlled applicant corrections', () => {
  const correction = {
    requestId: 'f0a0a0a0-1111-4111-8111-000000000001',
    fullName: 'Maria Santos-Reyes',
    birthDate: '1990-01-01',
    phone: '09171234567',
    sex: 'female' as const,
    civilStatus: 'married' as const,
    messenger: '',
    employerName: '',
    jobPosition: '',
    reason: '',
  };
  it('accepts a correction and canonicalizes the phone', () => {
    const parsed = updateOstApplicantSchema.safeParse(correction);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phone).toBe('+639171234567');
      expect(parsed.data.reason).toBe('');
    }
  });
  it('keeps the login email and authoritative program state out of the payload', () => {
    expect(
      updateOstApplicantSchema.safeParse({ ...correction, email: 'new@example.invalid' }).success,
    ).toBe(false);
    expect(
      updateOstApplicantSchema.safeParse({ ...correction, programCategory: 'vip_holder' }).success,
    ).toBe(false);
  });
  it('requires the address and its reference codes together', () => {
    const address = { line1: 'QA STREET', city: 'Calauan', province: 'Laguna', countryCode: 'PH' };
    expect(updateOstApplicantSchema.safeParse({ ...correction, address }).success).toBe(false);
    expect(
      updateOstApplicantSchema.safeParse({
        ...correction,
        addressHierarchy: {
          regionCode: '0400000000',
          provinceCode: '0403400000',
          localityCode: '0403406000',
          barangayCode: '0403406003',
        },
      }).success,
    ).toBe(false);
    expect(
      updateOstApplicantSchema.safeParse({
        ...correction,
        address,
        addressHierarchy: {
          regionCode: '0400000000',
          provinceCode: '0403400000',
          localityCode: '0403406000',
          barangayCode: '0403406003',
        },
      }).success,
    ).toBe(true);
  });
  it('rejects a name carrying digits and a future birth date', () => {
    expect(updateOstApplicantSchema.safeParse({ ...correction, fullName: 'Maria 2' }).success).toBe(
      false,
    );
    expect(
      updateOstApplicantSchema.safeParse({ ...correction, birthDate: '2999-01-01' }).success,
    ).toBe(false);
  });
});
