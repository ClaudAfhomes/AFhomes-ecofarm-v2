import { describe, expect, it } from 'vitest';

import {
  MEMBER_POSITION_LABELS,
  MEMBER_UPLINE_ROLE,
  IST_POSITIONS,
  createMemberSchema,
  createOstMemberSchema,
  issueAccreditationSchema,
  manualIstAaNumberSchema,
  memberCivilStatusSchema,
  memberDetailSchema,
  memberSchema,
  memberSexSchema,
  positionKind,
  transferMemberSchema,
  updateMemberProfileSchema,
} from './member.js';
import { GOVERNMENT_ID_TYPE_LABELS, governmentIdTypeSchema } from './sales.js';

const body = {
  fullName: 'Jose Rizal',
  email: 'jose@afhomes.test',
  temporaryPassword: 'TempPass123',
  departmentId: '11111111-1111-4111-8111-111111111111',
  position: 'sales_manager',
  dateOfBirth: '1990-06-19',
  sex: 'Male',
  civilStatus: 'Single',
  streetNo: '123 Mango St',
  cityMunicipality: 'Calauan',
  province: 'Laguna',
  provinceCode: '0403400000',
  cityMunicipalityCode: '0403406000',
  zipCode: '4012',
  mobileNo: '+639171234567',
  employerName: 'AF Homes',
  employerAddress: 'Ecofarm, Laguna',
  jobPosition: 'Sales Manager',
  governmentIdType: 'passport',
  governmentIdNumber: 'P1234567',
  referrerStaffId: '22222222-2222-4222-8222-222222222222',
} as const;

describe('member contracts', () => {
  it('labels every position and maps the immediate head', () => {
    expect(MEMBER_POSITION_LABELS).toEqual({
      vice_director: 'Sales Vice Director',
      senior_sales_manager: 'Senior Sales Manager',
      sales_manager: 'Sales Manager',
      ost: 'OST',
    });
    expect(MEMBER_UPLINE_ROLE).toEqual({
      vice_director: null,
      senior_sales_manager: 'vice_director',
      sales_manager: 'senior_sales_manager',
      ost: 'sales_manager',
    });
  });

  it('accepts a complete member with optional fields absent', () => {
    const parsed = createMemberSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Casing is preserved server-side; the admin form uppercases live,
      // the same convention as staff creation.
      expect(parsed.data.fullName).toBe('Jose Rizal');
      expect(parsed.data.mobileNo).toBe('+639171234567');
      expect(parsed.data.ostReferrerStaffId).toBeUndefined();
    }
  });

  it('requires a head for every position except Vice Director', () => {
    const { referrerStaffId: _omitted, ...headless } = body;
    expect(createMemberSchema.safeParse(headless).success).toBe(false);
    expect(
      createMemberSchema.safeParse({
        ...headless,
        position: 'vice_director',
      }).success,
    ).toBe(true);
    expect(
      createMemberSchema.safeParse({
        ...body,
        position: 'vice_director',
      }).success,
    ).toBe(false);
  });

  it('keeps the OST referrer on Sales Managers only', () => {
    const ostReferrerStaffId = '33333333-3333-4333-8333-333333333333';
    expect(createMemberSchema.safeParse({ ...body, ostReferrerStaffId }).success).toBe(true);
    expect(
      createMemberSchema.safeParse({
        ...body,
        position: 'senior_sales_manager',
        referrerStaffId: '22222222-2222-4222-8222-222222222222',
        ostReferrerStaffId,
      }).success,
    ).toBe(false);
  });

  it('rejects invented sex, civil status and position values', () => {
    expect(memberSexSchema.safeParse('Other').success).toBe(false);
    expect(memberCivilStatusSchema.safeParse('Annulled').success).toBe(false);
    expect(createMemberSchema.safeParse({ ...body, position: 'employee' }).success).toBe(false);
  });

  it('rejects a future birth date and a short password', () => {
    expect(createMemberSchema.safeParse({ ...body, dateOfBirth: '2999-01-01' }).success).toBe(
      false,
    );
    expect(createMemberSchema.safeParse({ ...body, temporaryPassword: 'short' }).success).toBe(
      false,
    );
  });

  it('never carries age: it is derived at display time', () => {
    expect('age' in createMemberSchema.shape).toBe(false);
  });

  it('defaults the AA number to automatic', () => {
    const parsed = createMemberSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.aaNumberMode).toBe('auto');
      expect(parsed.data.aaNumber).toBeUndefined();
    }
  });

  it('requires the authority address codes', () => {
    const { provinceCode: _p, cityMunicipalityCode: _c, ...codeless } = body;
    expect(createMemberSchema.safeParse(codeless).success).toBe(false);
    expect(createMemberSchema.safeParse({ ...body, provinceCode: 'bogus' }).success).toBe(false);
  });

  it('accepts a typed IST AA number in manual mode only', () => {
    expect(
      createMemberSchema.safeParse({ ...body, aaNumberMode: 'manual', aaNumber: 'aai26100001' })
        .success,
    ).toBe(true);
    const lower = createMemberSchema.safeParse({
      ...body,
      aaNumberMode: 'manual',
      aaNumber: 'aai26100001',
    });
    if (lower.success) expect(lower.data.aaNumber).toBe('AAI26100001');
    // Manual without a number, automatic with one, and malformed numbers fail.
    expect(createMemberSchema.safeParse({ ...body, aaNumberMode: 'manual' }).success).toBe(false);
    expect(createMemberSchema.safeParse({ ...body, aaNumber: 'AAI26100001' }).success).toBe(false);
    expect(
      createMemberSchema.safeParse({ ...body, aaNumberMode: 'manual', aaNumber: 'NOPE' }).success,
    ).toBe(false);
    // OST is never created here, and an OST number is never typed onto an IST.
    expect(
      createMemberSchema.safeParse({
        ...body,
        position: 'ost',
        aaNumberMode: 'manual',
        aaNumber: 'AAI26100001',
        referrerStaffId: '33333333-3333-4333-8333-333333333333',
      }).success,
    ).toBe(false);
    expect(
      createMemberSchema.safeParse({ ...body, aaNumberMode: 'manual', aaNumber: 'AAO26100001' })
        .success,
    ).toBe(false);
    expect(manualIstAaNumberSchema.safeParse('AAABC').success).toBe(false);
    expect(manualIstAaNumberSchema.safeParse('AAAI26100001').success).toBe(false);
    expect(manualIstAaNumberSchema.safeParse('AAI26130001').success).toBe(false);
    expect(manualIstAaNumberSchema.safeParse('AAI26100000').success).toBe(false);
  });

  it('accepts an issued legacy AA number when typed manually', () => {
    expect(manualIstAaNumberSchema.safeParse('AA-K7Q2M9T4B1R8').success).toBe(true);
    expect(manualIstAaNumberSchema.safeParse('AA-ABCDEF123456').success).toBe(true);
    // The legacy shape still carries six letters and six digits.
    expect(manualIstAaNumberSchema.safeParse('AA-ABCDEFGHIJKL').success).toBe(false);
    expect(manualIstAaNumberSchema.safeParse('AAK7Q2M9T4B1R8').success).toBe(false);
  });

  it('derives the accreditation kind from the position', () => {
    expect(IST_POSITIONS).toEqual(['vice_director', 'senior_sales_manager', 'sales_manager']);
    expect(IST_POSITIONS.map(positionKind)).toEqual(['IST', 'IST', 'IST']);
    expect(positionKind('ost')).toBe('OST');
  });

  it('issues missing numbers with the same AUTO/MANUAL rules', () => {
    expect(issueAccreditationSchema.safeParse({}).success).toBe(true);
    expect(
      issueAccreditationSchema.safeParse({ aaNumberMode: 'manual', aaNumber: 'AAI26100001' })
        .success,
    ).toBe(true);
    expect(issueAccreditationSchema.safeParse({ aaNumberMode: 'manual' }).success).toBe(false);
  });

  it('stores member prose as entered, not uppercased', () => {
    const parsed = createMemberSchema.safeParse({ ...body, streetNo: '123 MANGO ST' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.streetNo).toBe('123 Mango St');
      expect(parsed.data.employerAddress).toBe('Ecofarm, Laguna');
    }
  });

  it('labels every ID type without leaking slugs', () => {
    expect(Object.keys(GOVERNMENT_ID_TYPE_LABELS).sort()).toEqual(
      [...governmentIdTypeSchema.options].sort(),
    );
    expect(GOVERNMENT_ID_TYPE_LABELS.philippine_id).toBe('Philippine ID');
  });

  it('updates accept a new display name', () => {
    expect(updateMemberProfileSchema.safeParse({ fullName: 'New Name' }).success).toBe(true);
    expect(updateMemberProfileSchema.safeParse({ fullName: 'N1' }).success).toBe(false);
  });

  it('updates carry the position, head, email and an administrator password reset', () => {
    const parsed = updateMemberProfileSchema.safeParse({
      position: 'senior_sales_manager',
      referrerStaffId: '33333333-3333-4333-8333-333333333333',
      headChangeReason: 'Promoted to the next level',
      email: 'New.Address@Example.COM',
      temporaryPassword: 'TempPass123',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.email).toBe('new.address@example.com');
    // The head reason, the password floor and the position catalogue all hold.
    expect(updateMemberProfileSchema.safeParse({ headChangeReason: 'no' }).success).toBe(false);
    expect(updateMemberProfileSchema.safeParse({ temporaryPassword: 'short' }).success).toBe(false);
    expect(updateMemberProfileSchema.safeParse({ position: 'employee' }).success).toBe(false);
    // A kind change is a transfer, never a profile edit.
    expect(updateMemberProfileSchema.safeParse({ position: 'ost' }).success).toBe(false);
    expect(updateMemberProfileSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('keeps the list shape masked and the single read clear', () => {
    const row = {
      id: '33333333-3333-4333-8333-333333333333',
      employeeNumber: 'AF-EMP-00003',
      fullName: 'SALES MANAGER',
      email: 'sm@afhomes.test',
      position: 'sales_manager',
      positionLabel: 'Sales Manager',
      departmentName: 'Sales',
      status: 'active',
      referrerName: null,
      ostReferrerName: null,
      referrerStaffId: null,
      ostReferrerStaffId: null,
      aaNumber: 'AA-ABC123',
      dateOfBirth: '1990-02-02',
      sex: 'Female',
      civilStatus: 'Single',
      streetNo: '2 Main St',
      cityMunicipality: 'Quezon City',
      province: 'Metro Manila',
      provinceCode: null,
      cityMunicipalityCode: null,
      zipCode: '1100',
      telNo: null,
      mobileNo: '+639172222222',
      fbMessenger: null,
      employerName: 'AF Homes',
      employerAddress: 'Ecofarm',
      jobPosition: 'Sales Manager',
      governmentIdType: 'drivers_license',
      tinMasked: '*****6789',
      governmentIdMasked: '****4321',
      createdAt: '2026-09-01T00:00:00.000Z',
    };
    // The list read has no plaintext fields at all.
    const list = memberSchema.parse(row);
    expect(list).not.toHaveProperty('tin');
    expect(list).not.toHaveProperty('governmentIdNumber');
    // The single read carries them, nullable when unrecorded.
    const clear = memberDetailSchema.parse({
      ...row,
      tin: '123456789',
      governmentIdNumber: 'D7654321',
    });
    expect(clear.tin).toBe('123456789');
    expect(clear.governmentIdNumber).toBe('D7654321');
    expect(
      memberDetailSchema.safeParse({ ...row, tin: null, governmentIdNumber: null }).success,
    ).toBe(true);
    // The detail shape is required to state both fields, null or not.
    expect(memberDetailSchema.safeParse(row).success).toBe(false);
  });

  /* ---- direct OST creation and transfers (Create OST / Transfer) ---- */
  const ostIdentity = {
    firstName: 'Maria',
    middleName: 'Santos',
    lastName: 'Dela Cruz',
    email: 'maria@afhomes.test',
    phone: '+639171234567',
    birthDate: '1990-06-19',
    address: {
      line1: '123 Mango St',
      city: 'Calauan',
      province: 'Laguna',
      postalCode: '4012',
    },
  };
  const ostForm = {
    dateApplied: '2026-10-01',
    programCategory: 'non_vip',
    vipCardType: null,
    sex: 'female',
    civilStatus: 'single',
    governmentIdType: 'passport',
    governmentIdNumber: 'P1234567',
    applicantSignatureStatus: 'received',
    referrerSignatureStatus: 'received',
    applicantSignedOn: '2026-10-01',
    referrerSignedOn: '2026-10-01',
  };
  const sponsorStaffId = '44444444-4444-4444-8444-444444444444';
  const requestId = '55555555-5555-4555-8555-555555555555';

  it('completes an OST only with signatures and approved validity', () => {
    const complete = {
      mode: 'complete',
      requestId,
      sponsorStaffId,
      identity: ostIdentity,
      form: ostForm,
      startsOn: '2026-10-16',
      expiresOn: '2027-10-16',
    };
    expect(createOstMemberSchema.safeParse(complete).success).toBe(true);
    // Expiry before the start, a missing date, and a missing signature fail.
    expect(createOstMemberSchema.safeParse({ ...complete, expiresOn: '2026-10-15' }).success).toBe(
      false,
    );
    expect(createOstMemberSchema.safeParse({ ...complete, startsOn: null }).success).toBe(false);
    expect(
      createOstMemberSchema.safeParse({
        ...complete,
        form: { ...ostForm, applicantSignatureStatus: 'pending', applicantSignedOn: null },
      }).success,
    ).toBe(false);
  });

  it('saves a pending OST without validity or signatures', () => {
    expect(
      createOstMemberSchema.safeParse({
        mode: 'pending',
        requestId,
        sponsorStaffId,
        identity: ostIdentity,
        form: {
          ...ostForm,
          applicantSignatureStatus: 'pending',
          applicantSignedOn: null,
          referrerSignatureStatus: 'pending',
          referrerSignedOn: null,
        },
      }).success,
    ).toBe(true);
  });

  it('transfers with a reason; IST -> OST carries the full footprint', () => {
    expect(
      transferMemberSchema.safeParse({
        direction: 'IST_TO_OST',
        requestId: 'ec801800-1234-4321-8765-aaaaaaaaaaaa',
        reason: 'Moved to OST by management decision',
        sponsorStaffId,
        identity: ostIdentity,
        form: ostForm,
        startsOn: '2026-10-16',
        expiresOn: '2027-10-16',
      }).success,
    ).toBe(true);
    // A short reason, a missing signature, an inverted window and no sponsor fail.
    const base = {
      direction: 'IST_TO_OST' as const,
      requestId: 'ec801800-1234-4321-8765-aaaaaaaaaaaa',
      reason: 'Moved to OST by management decision',
      sponsorStaffId,
      identity: ostIdentity,
      form: ostForm,
      startsOn: '2026-10-16',
      expiresOn: '2027-10-16',
    };
    expect(transferMemberSchema.safeParse({ ...base, reason: 'no' }).success).toBe(false);
    expect(transferMemberSchema.safeParse({ ...base, expiresOn: '2026-10-15' }).success).toBe(
      false,
    );
    expect(
      transferMemberSchema.safeParse({
        ...base,
        form: { ...ostForm, referrerSignatureStatus: 'pending', referrerSignedOn: null },
      }).success,
    ).toBe(false);
    const { sponsorStaffId: _s, ...sponsorless } = base;
    expect(transferMemberSchema.safeParse(sponsorless).success).toBe(false);
  });

  it('transfers OST -> IST only to a valid IST position with its head', () => {
    expect(
      transferMemberSchema.safeParse({
        direction: 'OST_TO_IST',
        requestId: 'ec801800-1234-4321-8765-aaaaaaaaaaaa',
        reason: 'Appointed Senior Sales Manager',
        targetPosition: 'senior_sales_manager',
        headStaffId: '66666666-6666-4666-8666-666666666666',
      }).success,
    ).toBe(true);
    // OST is not an IST target, a headless IST level fails, and a Vice
    // Director with a head fails.
    expect(
      transferMemberSchema.safeParse({
        direction: 'OST_TO_IST',
        requestId: 'ec801800-1234-4321-8765-aaaaaaaaaaaa',
        reason: 'Appointed to a hierarchy level',
        targetPosition: 'ost',
        headStaffId: null,
      }).success,
    ).toBe(false);
    expect(
      transferMemberSchema.safeParse({
        direction: 'OST_TO_IST',
        requestId: 'ec801800-1234-4321-8765-aaaaaaaaaaaa',
        reason: 'Appointed Sales Manager',
        targetPosition: 'sales_manager',
        headStaffId: null,
      }).success,
    ).toBe(false);
    expect(
      transferMemberSchema.safeParse({
        direction: 'OST_TO_IST',
        requestId: 'ec801800-1234-4321-8765-aaaaaaaaaaaa',
        reason: 'Appointed Sales Vice Director',
        targetPosition: 'vice_director',
        headStaffId: '66666666-6666-4666-8666-666666666666',
      }).success,
    ).toBe(false);
  });
});
