/**
 * AF Homes Phase 2 - pure commerce rules.
 *
 * Every function here is deterministic and side-effect free so the financial
 * rules can be tested without a database, a server, or a browser. The database
 * RPCs in `supabase/migrations/20260927000003_afhomes_phase2_rpc.sql` implement
 * the same rules transactionally; these functions are the readable reference
 * and are re-asserted against the RPC behaviour in the handler tests.
 *
 * Money is an exact-decimal STRING end to end. Arithmetic goes through
 * `@jad/shared`, which uses BigInt centavo - no float ever participates.
 */
import { addMoney, compareMoney, divideMoneyExact, multiplyMoney, subtractMoney } from '@jad/shared';
import type {
  PaymentScheme,
  PaymentStatus,
  SaleFinancialSummary,
  SpotCashState,
} from '@jad/contracts';

import { SPOT_CASH_DAYS } from './constants.js';

/** Days in the spot-cash window. Starts at the first VERIFIED payment. */
export const SPOT_CASH_WINDOW_DAYS = SPOT_CASH_DAYS;

/**
 * Commission is a percentage of the snapshotted card price, rounded half away
 * from zero to 2 decimals - the same rule as Postgres
 * `round(amount::numeric * rate::numeric, 2)`.
 *
 * Gold: 60000.00 x 0.04 = 2400.00
 */
export function calculateCommission(price: string, rate: string): string {
  return multiplyMoney(price, rate);
}

export type PaymentLike = {
  amount: string;
  status: PaymentStatus;
  recordedAt?: string;
  verifiedAt?: string | null;
};

/**
 * Authoritative money state for a sale, derived only from payment rows.
 *
 * A payment counts toward the price ONLY when it is `verified`. `recorded`
 * money is not yet money; `rejected` and `voided` money never was.
 */
export function summarizePayments(input: {
  cashPrice: string;
  minimumDownPayment: string;
  payments: PaymentLike[];
  /** First verified payment instant (ISO). Null until one exists. */
  spotCashStartedAt?: string | null;
  spotCashDeadline?: string | null;
  now?: Date;
  /**
   * Frozen scheme required initial (reservation for the standard tracks, the
   * DP for B1/B2). When present it is the down-payment threshold; otherwise
   * the legacy minimum down payment snapshot applies. Old sales (no scheme
   * snapshot) therefore behave exactly as before.
   */
  requiredInitial?: string | null;
}): {
  recordedTotal: string;
  verifiedTotal: string;
  rejectedTotal: string;
  remainingBalance: string;
  overpaidAmount: string;
  downPaymentSatisfied: boolean;
  fullyPaid: boolean;
  spotCashDeadline: string | null;
  spotCashState: SpotCashState;
} {
  const now = input.now ?? new Date();
  const downThreshold = input.requiredInitial ?? input.minimumDownPayment;

  const sumWhere = (predicate: (p: PaymentLike) => boolean) =>
    input.payments
      .filter((p) => p.status !== 'voided' && predicate(p))
      .reduce((total, p) => addMoney(total, p.amount), '0.00');

  const recordedTotal = sumWhere((p) => p.status === 'recorded');
  const verifiedTotal = sumWhere((p) => p.status === 'verified');
  const rejectedTotal = sumWhere((p) => p.status === 'rejected');

  const remainingBalance =
    compareMoney(verifiedTotal, input.cashPrice) >= 0
      ? '0.00'
      : subtractMoney(input.cashPrice, verifiedTotal);
  const overpaidAmount =
    compareMoney(verifiedTotal, input.cashPrice) > 0
      ? subtractMoney(verifiedTotal, input.cashPrice)
      : '0.00';

  return {
    recordedTotal,
    verifiedTotal,
    rejectedTotal,
    remainingBalance,
    overpaidAmount,
    // The required initial is judged on VERIFIED money only.
    downPaymentSatisfied: compareMoney(verifiedTotal, downThreshold) >= 0,
    fullyPaid: compareMoney(verifiedTotal, input.cashPrice) >= 0,
    spotCashDeadline: input.spotCashDeadline ?? null,
    spotCashState: deriveSpotCashState({
      fullyPaid: compareMoney(verifiedTotal, input.cashPrice) >= 0,
      spotCashStartedAt: input.spotCashStartedAt ?? null,
      spotCashDeadline: input.spotCashDeadline ?? null,
      now,
    }),
  };
}

/**
 * Spot-cash deadline = first verified payment + 7 days, in UTC.
 *
 * The window is closed at both ends of the start instant and open at the
 * deadline instant: `now <= deadline` is still `within_deadline`. It expires
 * only strictly after that instant.
 */
export function spotCashDeadlineFrom(startedAt: string | Date): string {
  const start = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;
  if (Number.isNaN(start.valueOf())) throw new Error('spotCashDeadlineFrom: invalid start date');
  return new Date(start.valueOf() + SPOT_CASH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function deriveSpotCashState(input: {
  fullyPaid: boolean;
  spotCashStartedAt: string | null;
  spotCashDeadline: string | null;
  now?: Date;
}): SpotCashState {
  // Fully paid settles the question regardless of the window.
  if (input.fullyPaid) return 'fully_paid';
  if (!input.spotCashDeadline) return 'not_started';
  const now = input.now ?? new Date();
  return now.valueOf() <= new Date(input.spotCashDeadline).valueOf() ? 'within_deadline' : 'expired';
}

/* ------------------------------------------------------------------ */
/* Product rules                                                       */
/* ------------------------------------------------------------------ */

export type SellableProduct = {
  id: string;
  isActive: boolean;
  cashPrice: string;
  /**
   * Legacy plan floor (pre-Stage-1 "minimum down payment"). Still the
   * coherence guard for sellability and the historical snapshot value, but
   * NOT the Stage 1 required initial - see `requiredInitial` on
   * `summarizePayments` and the frozen scheme snapshot on each sale.
   */
  minimumDownPayment: string;
  yearlyPoints: number;
  commissionRate: string;
};

export type ProductRejection =
  | 'PRODUCT_CATEGORY_INACTIVE'
  | 'PRODUCT_INACTIVE'
  | 'DOWN_PAYMENT_EXCEEDS_PRICE'
  | 'ZERO_PRICE';

/**
 * A product may only be sold when it is active, its category is active, and
 * its economics are coherent. The category defaults to active so existing
 * callers (and old tests) keep their meaning; the sale handler always passes
 * the real category state.
 */
export function productSaleRejection(
  product: Pick<SellableProduct, 'isActive' | 'cashPrice' | 'minimumDownPayment'>,
  categoryIsActive = true,
): ProductRejection | null {
  if (!categoryIsActive) return 'PRODUCT_CATEGORY_INACTIVE';
  if (!product.isActive) return 'PRODUCT_INACTIVE';
  if (compareMoney(product.cashPrice, '0.00') <= 0) return 'ZERO_PRICE';
  if (compareMoney(product.minimumDownPayment, product.cashPrice) > 0) {
    return 'DOWN_PAYMENT_EXCEEDS_PRICE';
  }
  return null;
}

/** Snapshot the commercial terms of a sale so later price changes cannot alter it.
 *
 * `minimumDownPaymentSnapshot` keeps the legacy plan floor for historical
 * meaning. The live Stage 1 threshold is the frozen scheme-specific required
 * initial (`snapshotSchemeTerms`), which `summarizePayments` prefers whenever
 * the sale carries it.
 */
export function snapshotSaleTerms(product: SellableProduct) {
  return {
    cashPriceSnapshot: product.cashPrice,
    minimumDownPaymentSnapshot: product.minimumDownPayment,
    yearlyPointsSnapshot: product.yearlyPoints,
    commissionRateSnapshot: product.commissionRate,
    expectedCommissionSnapshot: calculateCommission(product.cashPrice, product.commissionRate),
  };
}

/* ------------------------------------------------------------------ */
/* VIP payment schemes (Stage 1 pre-opening value)                     */
/* ------------------------------------------------------------------ */

export type SchemePlan = {
  /** Spot Cash price - the base of the spot track. */
  cashPrice: string;
  /** Standard 4-month installment total (different from Spot Cash). */
  installmentPrice?: string | null;
  /** Reservation fee, included in every total, never added on top. */
  reservationFee?: string | null;
  spotCashDays?: number | null;
  standardInstallmentMonths?: number | null;
  /** Membership validity in years, frozen onto each sale. */
  validityYears?: number | null;
  moveAEnabled?: boolean | null;
  moveB1Enabled?: boolean | null;
  moveB2Enabled?: boolean | null;
};

export type SchemeEconomics = {
  scheme: PaymentScheme;
  /** Frozen selected total: Spot Cash total on the spot track, installment total otherwise. */
  total: string;
  /** Frozen reservation fee included in the total. */
  reservationFee: string;
  /** Frozen required initial: reservation for the standard tracks, DP for B1/B2. */
  requiredInitial: string;
  /** Frozen installment month count (null when the scheme has no installments). */
  installmentMonths: number | null;
  /** Frozen monthly amount (null when the scheme has no installments). */
  monthlyAmount: string | null;
  /** Frozen membership validity in months (validity years x 12). */
  validityMonths: number;
};

export type SchemeRejection =
  | 'SCHEME_NOT_ALLOWED_FOR_TIER'
  | 'INSTALLMENT_PRICE_NOT_SET'
  | 'INEXACT_SCHEDULE';

/** Database defaults for plan columns older rows may lack. */
const SCHEME_DEFAULTS = {
  reservationFee: '10000.00',
  spotCashDays: 7,
  standardInstallmentMonths: 4,
  validityYears: 1,
  moveAEnabled: true,
  moveB1Enabled: true,
  moveB2Enabled: true,
} as const;

/**
 * Exact division of an exact-decimal amount by a positive integer month count.
 * Single implementation lives in `@jad/shared` (also used for display math);
 * it throws rather than rounding, so an inexact schedule is a loud error.
 */
function divideSchedule(amount: string, months: number): string {
  try {
    return divideMoneyExact(amount, months);
  } catch {
    throw new Error(`divideSchedule: ${amount} / ${months} is inexact`);
  }
}

function schemePlanDefaults(plan: SchemePlan) {
  return {
    installmentPrice: plan.installmentPrice ?? '0.00',
    reservationFee: plan.reservationFee ?? SCHEME_DEFAULTS.reservationFee,
    standardInstallmentMonths:
      plan.standardInstallmentMonths ?? SCHEME_DEFAULTS.standardInstallmentMonths,
    validityYears: plan.validityYears ?? SCHEME_DEFAULTS.validityYears,
    moveAEnabled: plan.moveAEnabled ?? SCHEME_DEFAULTS.moveAEnabled,
    moveB1Enabled: plan.moveB1Enabled ?? SCHEME_DEFAULTS.moveB1Enabled,
    moveB2Enabled: plan.moveB2Enabled ?? SCHEME_DEFAULTS.moveB2Enabled,
  };
}

/**
 * Resolve the frozen economics for a plan + scheme pair.
 *
 * Pure and exact-decimal end to end (BigInt centavos; no float). The client
 * sends only the scheme code; every figure comes from the plan row, so a
 * tampered body cannot change what a sale costs. Bronze (Move B1/B2 flags
 * off) is rejected here - the UI hiding the options is never the control.
 */
export function resolveSchemeEconomics(
  plan: SchemePlan,
  scheme: PaymentScheme,
): { economics: SchemeEconomics } | { error: SchemeRejection } {
  const d = schemePlanDefaults(plan);
  const validityMonths = d.validityYears * 12;

  if (scheme === 'spot_cash') {
    return {
      economics: {
        scheme,
        total: plan.cashPrice,
        reservationFee: d.reservationFee,
        requiredInitial: d.reservationFee,
        installmentMonths: null,
        monthlyAmount: null,
        validityMonths,
      },
    };
  }

  if (scheme === 'move_a') {
    if (!d.moveAEnabled) return { error: 'SCHEME_NOT_ALLOWED_FOR_TIER' };
    const balance = subtractMoney(plan.cashPrice, d.reservationFee);
    let monthly: string;
    try {
      monthly = divideSchedule(balance, 4);
    } catch {
      return { error: 'INEXACT_SCHEDULE' };
    }
    return {
      economics: {
        scheme,
        total: plan.cashPrice,
        reservationFee: d.reservationFee,
        requiredInitial: d.reservationFee,
        installmentMonths: 4,
        monthlyAmount: monthly,
        validityMonths,
      },
    };
  }

  // Every installment-track scheme shares the installment total. A plan with
  // no installment price configured cannot be sold on this track.
  if (compareMoney(d.installmentPrice, '0.00') <= 0) return { error: 'INSTALLMENT_PRICE_NOT_SET' };

  if (scheme === 'installment_4_month') {
    const balance = subtractMoney(d.installmentPrice, d.reservationFee);
    let monthly: string;
    try {
      monthly = divideSchedule(balance, d.standardInstallmentMonths);
    } catch {
      return { error: 'INEXACT_SCHEDULE' };
    }
    return {
      economics: {
        scheme,
        total: d.installmentPrice,
        reservationFee: d.reservationFee,
        requiredInitial: d.reservationFee,
        installmentMonths: d.standardInstallmentMonths,
        monthlyAmount: monthly,
        validityMonths,
      },
    };
  }

  if (scheme === 'move_b1_40_12' || scheme === 'move_b2_25_12') {
    const allowed = scheme === 'move_b1_40_12' ? d.moveB1Enabled : d.moveB2Enabled;
    if (!allowed) return { error: 'SCHEME_NOT_ALLOWED_FOR_TIER' };
    const rate = scheme === 'move_b1_40_12' ? '0.40' : '0.25';
    const downPayment = multiplyMoney(d.installmentPrice, rate);
    const balance = subtractMoney(d.installmentPrice, downPayment);
    let monthly: string;
    try {
      monthly = divideSchedule(balance, 12);
    } catch {
      return { error: 'INEXACT_SCHEDULE' };
    }
    return {
      economics: {
        scheme,
        total: d.installmentPrice,
        reservationFee: d.reservationFee,
        requiredInitial: downPayment,
        installmentMonths: 12,
        monthlyAmount: monthly,
        validityMonths,
      },
    };
  }

  return { error: 'SCHEME_NOT_ALLOWED_FOR_TIER' };
}

/**
 * Snapshot the selected scheme economics onto a sale so later plan edits
 * cannot alter it. `cashPriceSnapshot` carries the frozen SELECTED total and
 * `minimumDownPaymentSnapshot` keeps the plan floor; the scheme figures ride
 * in their own columns.
 */
export function snapshotSchemeTerms(economics: SchemeEconomics) {
  return {
    paymentScheme: economics.scheme,
    schemeTotalSnapshot: economics.total,
    reservationFeeSnapshot: economics.reservationFee,
    requiredInitialSnapshot: economics.requiredInitial,
    installmentMonthsSnapshot: economics.installmentMonths,
    monthlyAmountSnapshot: economics.monthlyAmount,
    validityMonthsSnapshot: economics.validityMonths,
  };
}

/* ------------------------------------------------------------------ */
/* Seller resolution                                                   */
/* ------------------------------------------------------------------ */

export type SellerCandidate = { staffId: string; roleSlug: string; status: string };

export type SellerRejection =
  | 'SELLER_INACTIVE'
  | 'SELLER_ROLE_NOT_A_SELLER'
  | 'SELLER_NOT_IN_YOUR_DOWNLINE'
  | 'SELLER_CANNOT_SELL_FOR_SELF';

/** Roles permitted to appear as the seller of record on a card sale. */
export const SELLING_ROLES: readonly string[] = [
  'ost',
  'sales_manager',
  'senior_sales_manager',
  'vice_director',
  'admin',
  'super_admin',
];

export function isSellingRole(roleSlug: string): boolean {
  return SELLING_ROLES.includes(roleSlug);
}

/**
 * Decide which staff account is recorded as the seller.
 *
 * `requestedSellerId` is a REQUEST, never an identity assertion. An omitted
 * value means "me". A supplied value is honoured only when the target is an
 * active seller inside the caller's own downline, so a caller can never
 * impersonate an unrelated seller by editing request JSON.
 */
export function resolveSeller(input: {
  actorId: string;
  actorRole: string;
  requestedSellerId?: string;
  target?: SellerCandidate | null;
  /** Staff ids the actor may sell on behalf of (their downline + themselves). */
  downlineIds: readonly string[];
}): { staffId: string } | { error: SellerRejection } {
  const { actorId, actorRole, requestedSellerId, target, downlineIds } = input;

  if (!requestedSellerId || requestedSellerId === actorId) {
    if (target && target.staffId === actorId && target.status !== 'active') {
      return { error: 'SELLER_INACTIVE' };
    }
    if (target && target.staffId === actorId && !isSellingRole(target.roleSlug)) {
      return { error: 'SELLER_ROLE_NOT_A_SELLER' };
    }
    return { staffId: actorId };
  }

  if (!target) return { error: 'SELLER_NOT_IN_YOUR_DOWNLINE' };
  if (target.status !== 'active') return { error: 'SELLER_INACTIVE' };
  if (!isSellingRole(target.roleSlug)) return { error: 'SELLER_ROLE_NOT_A_SELLER' };
  if (actorRole !== 'super_admin' && !downlineIds.includes(target.staffId)) {
    return { error: 'SELLER_NOT_IN_YOUR_DOWNLINE' };
  }
  return { staffId: target.staffId };
}

/* ------------------------------------------------------------------ */
/* Summary assembly                                                    */
/* ------------------------------------------------------------------ */

/** Merge the pure summary into the API response shape. */
export function toSummaryResponse(
  input: Parameters<typeof summarizePayments>[0] & {
    saleId: string;
    status: string;
    paymentScheme?: string;
    reservationFee?: string;
    requiredInitial?: string;
    installmentMonths?: number | null;
    monthlyAmount?: string | null;
  },
): SaleFinancialSummary {
  const totals = summarizePayments(input);
  return {
    saleId: input.saleId,
    status: input.status as SaleFinancialSummary['status'],
    cashPrice: input.cashPrice,
    minimumDownPayment: input.minimumDownPayment,
    paymentScheme: (input.paymentScheme ?? 'spot_cash') as SaleFinancialSummary['paymentScheme'],
    reservationFee: input.reservationFee ?? '0.00',
    requiredInitial: input.requiredInitial ?? input.minimumDownPayment,
    installmentMonths: input.installmentMonths ?? null,
    monthlyAmount: input.monthlyAmount ?? null,
    recordedTotal: totals.recordedTotal,
    verifiedTotal: totals.verifiedTotal,
    rejectedTotal: totals.rejectedTotal,
    remainingBalance: totals.remainingBalance,
    overpaidAmount: totals.overpaidAmount,
    downPaymentSatisfied: totals.downPaymentSatisfied,
    fullyPaid: totals.fullyPaid,
    spotCashDeadline: totals.spotCashDeadline,
    spotCashState: totals.spotCashState,
  };
}
