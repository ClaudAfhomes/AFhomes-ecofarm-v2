import { describe, expect, it } from 'vitest';

import { settlementStatus } from './format';

describe('settlementStatus', () => {
  it('reads Fully Paid when Total equals Paid and Balance is zero', () => {
    expect(settlementStatus('60000.00', '60000.00', '0.00')).toBe('Fully Paid');
  });

  it('reads Unsettled when Balance remains and Paid trails Total', () => {
    expect(settlementStatus('60000.00', '15000.00', '45000.00')).toBe('Unsettled');
  });

  it('derives the balance when only Total and Paid arrive', () => {
    expect(settlementStatus('60000.00', '60000.00')).toBe('Fully Paid');
    expect(settlementStatus('60000.00', '0.00')).toBe('Unsettled');
  });

  it('settles an overpayment with nothing remaining', () => {
    expect(settlementStatus('60000.00', '65000.00', '0.00')).toBe('Fully Paid');
  });

  it('fails closed to Unsettled on missing, zero, or malformed figures', () => {
    expect(settlementStatus('0.00', '0.00', '0.00')).toBe('Unsettled');
    expect(settlementStatus(null, '0.00', '0.00')).toBe('Unsettled');
    expect(settlementStatus('60000.00', null, '60000.00')).toBe('Unsettled');
    expect(settlementStatus('much', '0.00', 'much')).toBe('Unsettled');
  });
});
