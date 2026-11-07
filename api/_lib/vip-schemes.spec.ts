/**
 * VIP Stage 1 payment schemes - exact computation pins.
 *
 * Every figure below comes from the VIP PAYMENT SCHEME GUIDELINES (Stage 1
 * pre-opening value). Money is exact-decimal strings end to end; these tests
 * assert the exact strings so a float can never sneak into the schedule math.
 */
import { describe, expect, it } from 'vitest';

import { validateSchemeTransition } from '@afhomes/contracts';

import {
  calculateCommission,
  resolveSchemeEconomics,
  snapshotSchemeTerms,
  type SchemePlan,
} from './commerce.js';

const BRONZE: SchemePlan = {
  cashPrice: '54000.00',
  installmentPrice: '72000.00',
  reservationFee: '10000.00',
  spotCashDays: 7,
  standardInstallmentMonths: 4,
  validityYears: 7,
  moveAEnabled: true,
  moveB1Enabled: false,
  moveB2Enabled: false,
};

const SILVER: SchemePlan = {
  cashPrice: '192000.00',
  installmentPrice: '240000.00',
  reservationFee: '10000.00',
  spotCashDays: 7,
  standardInstallmentMonths: 4,
  validityYears: 12,
  moveAEnabled: true,
  moveB1Enabled: true,
  moveB2Enabled: true,
};

const GOLD: SchemePlan = {
  cashPrice: '312000.00',
  installmentPrice: '390000.00',
  reservationFee: '10000.00',
  spotCashDays: 7,
  standardInstallmentMonths: 4,
  validityYears: 22,
  moveAEnabled: true,
  moveB1Enabled: true,
  moveB2Enabled: true,
};

const economicsOf = (plan: SchemePlan, scheme: 'spot_cash' | 'move_a' | 'installment_4_month' | 'move_b1_40_12' | 'move_b2_25_12') => {
  const result = resolveSchemeEconomics(plan, scheme);
  if ('error' in result) throw new Error(`unexpected scheme error: ${result.error}`);
  return result.economics;
};

describe('standard offer totals', () => {
  it('pins each tier total exactly', () => {
    expect(economicsOf(BRONZE, 'spot_cash').total).toBe('54000.00');
    expect(economicsOf(SILVER, 'spot_cash').total).toBe('192000.00');
    expect(economicsOf(GOLD, 'spot_cash').total).toBe('312000.00');
    expect(economicsOf(BRONZE, 'installment_4_month').total).toBe('72000.00');
    expect(economicsOf(SILVER, 'installment_4_month').total).toBe('240000.00');
    expect(economicsOf(GOLD, 'installment_4_month').total).toBe('390000.00');
  });

  it('reservation fee is 10000 on every tier and scheme', () => {
    for (const plan of [BRONZE, SILVER, GOLD]) {
      for (const scheme of [
        'spot_cash',
        'move_a',
        'installment_4_month',
        'move_b1_40_12',
        'move_b2_25_12',
      ] as const) {
        if (plan === BRONZE && (scheme === 'move_b1_40_12' || scheme === 'move_b2_25_12')) continue;
        expect(economicsOf(plan, scheme).reservationFee).toBe('10000.00');
      }
    }
  });

  it('validity freezes to 7/12/22 years (84/144/264 months)', () => {
    expect(economicsOf(BRONZE, 'spot_cash').validityMonths).toBe(84);
    expect(economicsOf(SILVER, 'spot_cash').validityMonths).toBe(144);
    expect(economicsOf(GOLD, 'spot_cash').validityMonths).toBe(264);
  });
});

describe('Move A keeps the Spot Cash total', () => {
  it.each([
    ['BRONZE', BRONZE, '54000.00', '44000.00', '11000.00'],
    ['SILVER', SILVER, '192000.00', '182000.00', '45500.00'],
    ['GOLD', GOLD, '312000.00', '302000.00', '75500.00'],
  ])('%s: total=%s balance=%s monthly=%s x4', (_name, plan, total, _balance, monthly) => {
    const e = economicsOf(plan, 'move_a');
    expect(e.total).toBe(total);
    expect(e.requiredInitial).toBe('10000.00');
    expect(e.installmentMonths).toBe(4);
    expect(e.monthlyAmount).toBe(monthly);
  });
});

describe('standard 4-month installment', () => {
  it.each([
    ['BRONZE', BRONZE, '72000.00', '15500.00'],
    ['SILVER', SILVER, '240000.00', '57500.00'],
    ['GOLD', GOLD, '390000.00', '95000.00'],
  ])('%s: total=%s monthly=%s x4', (_name, plan, total, monthly) => {
    const e = economicsOf(plan, 'installment_4_month');
    expect(e.total).toBe(total);
    expect(e.requiredInitial).toBe('10000.00');
    expect(e.installmentMonths).toBe(4);
    expect(e.monthlyAmount).toBe(monthly);
  });
});

describe('Move B1 (40% DP + 12 months)', () => {
  it('Silver: 96000 DP + 12000 x12', () => {
    const e = economicsOf(SILVER, 'move_b1_40_12');
    expect(e.total).toBe('240000.00');
    expect(e.requiredInitial).toBe('96000.00');
    expect(e.installmentMonths).toBe(12);
    expect(e.monthlyAmount).toBe('12000.00');
  });

  it('Gold: 156000 DP + 19500 x12', () => {
    const e = economicsOf(GOLD, 'move_b1_40_12');
    expect(e.total).toBe('390000.00');
    expect(e.requiredInitial).toBe('156000.00');
    expect(e.installmentMonths).toBe(12);
    expect(e.monthlyAmount).toBe('19500.00');
  });
});

describe('Move B2 (25% DP + 12 months)', () => {
  it('Silver: 60000 DP + 15000 x12', () => {
    const e = economicsOf(SILVER, 'move_b2_25_12');
    expect(e.total).toBe('240000.00');
    expect(e.requiredInitial).toBe('60000.00');
    expect(e.installmentMonths).toBe(12);
    expect(e.monthlyAmount).toBe('15000.00');
  });

  it('Gold: 97500 DP + 24375 x12', () => {
    const e = economicsOf(GOLD, 'move_b2_25_12');
    expect(e.total).toBe('390000.00');
    expect(e.requiredInitial).toBe('97500.00');
    expect(e.installmentMonths).toBe(12);
    expect(e.monthlyAmount).toBe('24375.00');
  });
});

describe('Bronze restriction (server-side, never UI-only)', () => {
  it('rejects B1 for Bronze', () => {
    expect(resolveSchemeEconomics(BRONZE, 'move_b1_40_12')).toEqual({
      error: 'SCHEME_NOT_ALLOWED_FOR_TIER',
    });
  });

  it('rejects B2 for Bronze', () => {
    expect(resolveSchemeEconomics(BRONZE, 'move_b2_25_12')).toEqual({
      error: 'SCHEME_NOT_ALLOWED_FOR_TIER',
    });
  });

  it('still allows Spot Cash, Move A and standard installment for Bronze', () => {
    for (const scheme of ['spot_cash', 'move_a', 'installment_4_month'] as const) {
      expect(resolveSchemeEconomics(BRONZE, scheme)).not.toHaveProperty('error');
    }
  });
});

describe('golden-rule transitions', () => {
  it('rejects Move A -> B1 and Move A -> B2', () => {
    expect(validateSchemeTransition('move_a', 'move_b1_40_12')).toEqual({
      error: 'MOVE_A_CANNOT_CHAIN',
    });
    expect(validateSchemeTransition('move_a', 'move_b2_25_12')).toEqual({
      error: 'MOVE_A_CANNOT_CHAIN',
    });
  });

  it('allows staying on the same scheme (frozen)', () => {
    for (const scheme of [
      'spot_cash',
      'move_a',
      'installment_4_month',
      'move_b1_40_12',
      'move_b2_25_12',
    ] as const) {
      expect(validateSchemeTransition(scheme, scheme)).toEqual({ ok: true });
    }
  });
});

describe('commission basis is the frozen selected total at 4%', () => {
  it.each([
    ['Bronze spot/move_a 54000', '54000.00', '2160.00'],
    ['Bronze installment 72000', '72000.00', '2880.00'],
    ['Silver spot/move_a 192000', '192000.00', '7680.00'],
    ['Silver installment/B1/B2 240000', '240000.00', '9600.00'],
    ['Gold spot/move_a 312000', '312000.00', '12480.00'],
    ['Gold installment/B1/B2 390000', '390000.00', '15600.00'],
  ])('%s', (_name, total, expected) => {
    expect(calculateCommission(total, '0.04')).toBe(expected);
  });
});

describe('scheme snapshots freeze economics', () => {
  it('captures scheme, total, reservation, initial, months, monthly, validity', () => {
    expect(snapshotSchemeTerms(economicsOf(GOLD, 'move_b1_40_12'))).toEqual({
      paymentScheme: 'move_b1_40_12',
      schemeTotalSnapshot: '390000.00',
      reservationFeeSnapshot: '10000.00',
      requiredInitialSnapshot: '156000.00',
      installmentMonthsSnapshot: 12,
      monthlyAmountSnapshot: '19500.00',
      validityMonthsSnapshot: 264,
    });
  });

  it('spot cash carries no installments', () => {
    const snap = snapshotSchemeTerms(economicsOf(SILVER, 'spot_cash'));
    expect(snap.installmentMonthsSnapshot).toBeNull();
    expect(snap.monthlyAmountSnapshot).toBeNull();
    expect(snap.validityMonthsSnapshot).toBe(144);
  });
});

describe('no floating-point drift', () => {
  it('every schedule re-adds to its balance exactly', () => {
    const cases = [
      economicsOf(BRONZE, 'move_a'),
      economicsOf(SILVER, 'move_a'),
      economicsOf(GOLD, 'move_a'),
      economicsOf(BRONZE, 'installment_4_month'),
      economicsOf(SILVER, 'installment_4_month'),
      economicsOf(GOLD, 'installment_4_month'),
      economicsOf(SILVER, 'move_b1_40_12'),
      economicsOf(GOLD, 'move_b1_40_12'),
      economicsOf(SILVER, 'move_b2_25_12'),
      economicsOf(GOLD, 'move_b2_25_12'),
    ];
    for (const e of cases) {
      // monthly x months + requiredInitial must equal total, in cents.
      const cents = (v: string) => {
        const [w = '0', f = ''] = v.split('.');
        return BigInt(w) * 100n + BigInt((f + '00').slice(0, 2));
      };
      const rebuilt =
        cents(e.requiredInitial) + cents(e.monthlyAmount ?? '0.00') * BigInt(e.installmentMonths ?? 0);
      // For standard tracks the required initial IS the reservation, so the
      // schedule is reservation + months x monthly = total.
      expect(rebuilt).toBe(cents(e.total));
      for (const v of [e.total, e.reservationFee, e.requiredInitial, e.monthlyAmount ?? '0.00']) {
        expect(v).toMatch(/^\d+\.\d{2}$/);
        expect(v).not.toMatch(/e/i);
      }
    }
  });

  it('points are untouched by scheme resolution', () => {
    // Scheme economics carry no points field at all: yearly allocation stays
    // on the plan snapshot, which resolveSchemeEconomics never reads.
    expect('yearlyPoints' in economicsOf(GOLD, 'move_b1_40_12')).toBe(false);
  });
});
