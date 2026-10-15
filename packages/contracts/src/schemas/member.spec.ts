import { describe, expect, it } from 'vitest';

import {
  MEMBER_POSITION_LABELS,
  MEMBER_UPLINE_ROLE,
  createMemberSchema,
  memberCivilStatusSchema,
  memberSexSchema,
} from './member.js';

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
  cityMunicipality: 'Makati',
  province: 'Metro Manila',
  zipCode: '1200',
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
    expect(
      createMemberSchema.safeParse({ ...body, ostReferrerStaffId }).success,
    ).toBe(true);
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
});
