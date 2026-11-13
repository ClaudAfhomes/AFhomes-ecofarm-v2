import { expect, it } from 'vitest';
import { reservationAgreementSchema, type CardProduct } from '@afhomes/contracts';
import { emptyHolder } from './official-forms-fields';
import {
  draftReservationPaper,
  reservationPaperRows,
  savedReservationPaper,
} from './reservation-print';

const primary = {
  ...emptyHolder('PRIMARY'),
  firstName: 'MARÍA',
  lastName: 'SANTOS',
  suffix: 'V',
  mobile: '+639171234567',
  email: 'maria@example.test',
};
const secondary = { ...emptyHolder('SECONDARY'), firstName: 'JOSÉ', lastName: 'SANTOS' };
// Only benefit fields are used by the preliminary document; no price is inferred from this fixture.
const plan = {
  discountPercent: 17,
  cardholderLimit: 2,
  baseValidityYears: 8,
  validityExtensionYears: 2,
  yearlyPoints: 16000,
  annualPointsTranches: 8,
  priorityReservation: true,
  noMonthlyAnnualDues: true,
  totalLoyaltyValue: '128000.00',
} as CardProduct;

it.each(['BRONZE', 'SILVER', 'GOLD'])(
  'creates a %s preliminary form with real holder values and no invented reservation or paid figures',
  (tier) => {
    const data = draftReservationPaper(primary, secondary, tier, 'spot_cash', plan);
    const text = JSON.stringify(reservationPaperRows(data));
    expect(text).toContain('MARÍA SANTOS V');
    expect(text).toContain('17%');
    expect(text).toContain('PRELIMINARY FORM ONLY');
    expect(text).toContain('____________________');
    expect(text).not.toContain('60000');
    expect(text.includes('JOSÉ')).toBe(tier === 'GOLD');
    expect(data.agreement).toBeUndefined();
  },
);

it('uses frozen reservation terms, complete schedule and verified totals instead of current plan values', () => {
  const agreement = reservationAgreementSchema.parse({
    id: '00000000-0000-4000-8000-000000000001',
    planId: '00000000-0000-4000-8000-000000000002',
    reservationNumber: '2026-0001',
    tier: 'GOLD',
    totalPrice: '90000.00',
    reservationFee: '10000.00',
    downPayment: '20000.00',
    totalPaymentReceived: '5000.00',
    balance: '85000.00',
    monthlyAmortization: '10000.00',
    installmentMonths: 6,
    paymentScheme: 'spot_cash',
    discountPercent: 12,
    validityYears: 11,
    yearlyPoints: 11000,
    annualPointsTranches: 9,
    holderLimit: 2,
    reservationDate: '2026-11-07',
    agreementDate: '2026-11-08',
    inclusions: { priorityReservation: true, noMonthlyAnnualDues: true },
    primary: {
      holderType: 'PRIMARY',
      name: 'ANA SANTOS',
      address: '1 MAIN STREET',
      contactNumber: '+639171234567',
      email: 'ana@example.test',
    },
    schedule: [
      { lineNumber: 1, particular: 'Installment', amount: '12000.00', paymentDate: '2026-12-07' },
      { lineNumber: 2, particular: 'Balance', amount: '13000.00', paymentDate: '2027-01-07' },
    ],
    status: 'draft',
    createdAt: '2026-11-07T00:00:00Z',
    updatedAt: '2026-11-07T00:00:00Z',
    submittedAt: null,
    executedAt: null,
  });
  const data = { ...savedReservationPaper(agreement), plan };
  const rows = reservationPaperRows(data);
  const text = JSON.stringify(rows);
  expect(text).toContain('12%');
  expect(text).not.toContain('17%');
  expect(text).toContain('11 years');
  expect(text).toContain('2026-0001');
  expect(text).toContain('2027-01-07');
  expect(text).toContain('Scheduled date (not payment verification)');
  expect(
    rows
      .flatMap((row) => row.cells ?? [])
      .find((cell) => cell.label === 'Verified total payment received')?.value,
  ).toContain('5,000');
  expect(
    rows
      .flatMap((row) => row.cells ?? [])
      .filter((cell) => cell.label === 'Date of payment')
      .every((cell) => cell.value === '____________________'),
  ).toBe(true);
  expect(rows.at(-1)).toEqual({ signature: true });
});

it('prints entered RA draft details without marking money verified', () => {
 const text = JSON.stringify(reservationPaperRows(draftReservationPaper(primary, null, 'SILVER', 'move_a', plan, {
  reservationDate: '2026-11-08', reservationNumber: 'PROPOSED-123', reservationPaymentDate: '2026-11-09', totalPrice: '111111.00', paymentReference: 'REF-ONLY',
 })));
 expect(text).toContain('PROPOSED-123'); expect(text).toContain('2026-11-09'); expect(text).toContain('111,111.00'); expect(text).toContain('REF-ONLY');
 expect(text).toContain('payments are unverified');
});

it('never labels a legacy draft proposal as an official RA number', () => {
 const rows=reservationPaperRows(draftReservationPaper(primary,null,'SILVER','spot_cash',plan,{reservationNumber:'LEGACY-PROPOSAL'}));
 expect(rows.flatMap(r=>r.cells??[]).find(c=>c.label==='Official Reservation Agreement Number')?.value).toBe('____________________');
 expect(rows.flatMap(r=>r.cells??[]).find(c=>c.label==='Legacy proposed reference (not official)')?.value).toBe('LEGACY-PROPOSAL');
});
