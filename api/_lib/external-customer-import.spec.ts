import { describe, expect, it } from 'vitest';
import { externalImportSummary } from './external-customer-import.js';
import type { WorkbookPaymentClaim } from '@afhomes/contracts';
const fields = { contract_date: '2026-10-01', stated_total: '312000.00', stated_rf: '10000.00' };
const payments = (amount: string) => [{ amount }] as WorkbookPaymentClaim[];
describe('externally verified import routing', () => {
  it.each([
    ['Pending', [], 'application', '312000.00'],
    ['Reservation Paid', payments('10000.00'), 'reservation', '302000.00'],
    ['Partially Paid', payments('110000.00'), 'finance', '202000.00'],
    ['Down Payment', payments('78000.00'), 'finance', '234000.00'],
    ['Fully Paid', payments('312000.00'), 'activation', '0.00'],
  ] as const)('routes %s from the ledger amounts', (status, rows, stage, balance) => {
    expect(externalImportSummary({ ...fields, stated_status: status }, [...rows])).toMatchObject({
      stage,
      balance,
    });
  });
  it.each(['Fully Paid', 'Pending', 'Reservation Paid', 'Active VIP', 'Expired'])(
    'rejects unsupported or contradictory %s',
    (status) => {
      expect(() =>
        externalImportSummary({ ...fields, stated_status: status }, payments('50000.00')),
      ).toThrow();
    },
  );
  it('requires an actual contract date and rejects overpayments', () => {
    expect(() =>
      externalImportSummary({ ...fields, contract_date: '', stated_status: 'Pending' }, []),
    ).toThrow('Contract date');
    expect(() =>
      externalImportSummary({ ...fields, stated_status: 'Fully Paid' }, payments('312000.01')),
    ).toThrow('exceeds');
  });
});
