import { describe, expect, it } from 'vitest';

import { formatPoints, percentToRate, rateToPercent, settlementStatus } from './format';

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

describe('formatPoints', () => {
  it('groups thousands separators (8000 -> 8,000)', () => {
    expect(formatPoints(8000)).toBe('8,000');
    expect(formatPoints(4)).toBe('4');
  });

  it('renders an em dash for missing counts', () => {
    expect(formatPoints(null)).toBe('—');
    expect(formatPoints(undefined)).toBe('—');
  });
});

describe('percentToRate', () => {
  it('converts percent text to an exact four-decimal rate', () => {
    expect(percentToRate('4')).toBe('0.0400');
    expect(percentToRate('4.5')).toBe('0.0450');
    expect(percentToRate('12.25')).toBe('0.1225');
    expect(percentToRate('0')).toBe('0.0000');
    expect(percentToRate('100')).toBe('1.0000');
  });

  it('refuses anything outside 0 to 100 with two decimals', () => {
    for (const bad of ['', 'abc', '-1', '100.01', '101', '1.234', '4%'])
      expect(percentToRate(bad)).toBeNull();
  });

  it('round-trips with the stored rate', () => {
    expect(rateToPercent('0.0400')).toBe('4.00');
    expect(percentToRate(rateToPercent('0.1225'))).toBe('0.1225');
  });
});
