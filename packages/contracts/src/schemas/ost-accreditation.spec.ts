import { describe, expect, it } from 'vitest';
import {
  approveOstAccreditationSchema,
  manualOstAccreditationSchema,
  ostOfficialFormSchema,
  submitOstAccreditationSchema,
  submitOstRenewalSchema,
} from './ost-accreditation.js';
const form = {
  dateApplied: '2026-01-01',
  programCategory: 'non_vip',
  sex: 'male',
  civilStatus: 'single',
  governmentIdType: 'QA ID',
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
