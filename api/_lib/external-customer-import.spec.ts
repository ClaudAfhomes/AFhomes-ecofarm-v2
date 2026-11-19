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
  it('accepts certified settlement without inventing individual receipts', () => {
    expect(externalImportSummary({ ...fields, stated_status: 'Fully Paid' }, [])).toMatchObject({
      stage: 'activation', paid: fields.stated_total, settlement: 'certified',
    });
    expect(() => externalImportSummary({ ...fields, stated_status: 'Fully Paid' }, payments('1.00'))).toThrow();
  });
  it('keeps historical lifecycle and confirmed points separate from new activation', () => {
    expect(externalImportSummary({ ...fields, stated_status: 'Active VIP', existing_stay_points_total: '10000' }, [])).toMatchObject({ stage: 'active', existingPoints: 10000, weekdayPoints: 7000, weekendPoints: 3000 });
    expect(externalImportSummary({ ...fields, stated_status: 'Expired', existing_stay_points_total: '0' }, [])).toMatchObject({ stage: 'inactive', existingPoints: 0 });
    expect(externalImportSummary({ ...fields, stated_status: 'Active VIP' }, []).existingPoints).toBeNull();
    expect(externalImportSummary({ ...fields, stated_status: 'Fully Paid', existing_card_activation_status: 'Active', existing_stay_points_total: '10000' }, []).stage).toBe('active');
  });
});
