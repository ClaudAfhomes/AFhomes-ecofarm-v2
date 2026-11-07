import { expect, it } from 'vitest';
import { aaNumberSchema, saleTeamAccreditationSchema } from './sale-team.js';
import { manageSaleTeamSchema } from './sale-team.js';

it('allows date-free IST employee identity but still requires OST validity', () => {
  const employee = {
    staffId: '00000000-0000-4000-8000-000000000001',
    aaNumber: 'AAI26100001',
    kind: 'IST',
    fullName: 'SYNTHETIC',
    status: 'accredited',
    startsOn: null,
    expiresOn: null,
  };
  expect(saleTeamAccreditationSchema.safeParse(employee).success).toBe(true);
  expect(
    saleTeamAccreditationSchema.safeParse({ ...employee, kind: 'OST', aaNumber: 'AAO26100001' })
      .success,
  ).toBe(false);
  expect(manageSaleTeamSchema.safeParse({ kind: 'IST', action: 'approve' }).success).toBe(true);
  expect(manageSaleTeamSchema.safeParse({ kind: 'IST', action: 'revoke' }).success).toBe(false);
});

it.each(['AAI26100001', 'AAO26100002', 'AAI26019999', 'AAO26120001'])(
  'accepts official accreditation number %s',
  (value) => expect(aaNumberSchema.parse(` ${value.toLowerCase()} `)).toBe(value),
);

it.each(['AAI26000001', 'AAO26130001', 'AAI26100000', 'AAO261000001', 'JAI26100001'])(
  'rejects invalid official accreditation number %s',
  (value) => expect(aaNumberSchema.safeParse(value).success).toBe(false),
);

it('rejects a typed accreditation number belonging to the other seller kind', () => {
  const record = {
    staffId: '00000000-0000-4000-8000-000000000001',
    aaNumber: 'AAI26100001',
    kind: 'IST',
    fullName: 'Synthetic Seller',
    status: 'accredited',
    startsOn: '2026-10-01',
    expiresOn: '2027-09-30',
  };
  expect(saleTeamAccreditationSchema.safeParse(record).success).toBe(true);
  expect(saleTeamAccreditationSchema.safeParse({ ...record, kind: 'OST' }).success).toBe(false);
  expect(
    saleTeamAccreditationSchema.safeParse({ ...record, aaNumber: 'AAO26100001', kind: 'OST' })
      .success,
  ).toBe(true);
});

it('accepts six letters and six digits, normalizing typed case and spacing', () => {
  expect(aaNumberSchema.parse(' aa-k7q2m9t4b1r8 ')).toBe('AA-K7Q2M9T4B1R8');
  expect(aaNumberSchema.parse('AA-ABCDEF123456')).toBe('AA-ABCDEF123456');
});
it.each([
  'AA-00000001',
  'AA-ABCDEFGHIJKL',
  'AA-123456789012',
  'AA-ABCDE1234567',
  'AA-ABCDEFG12345',
  'AA-ABCDEF12345!',
])('rejects invalid AA composition %s', (value) => {
  expect(aaNumberSchema.safeParse(value).success).toBe(false);
});
