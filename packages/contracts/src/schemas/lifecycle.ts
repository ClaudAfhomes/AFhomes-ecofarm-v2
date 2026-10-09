/**
 * AF Homes lifecycle states and their legal transitions.
 *
 * Single source of truth for every status string in the system. Handlers,
 * contracts, and tests all import from here so a state can never be spelled two
 * ways or transitioned illegally.
 *
 * Each entity owns exactly ONE state machine, which is why a customer and its
 * sale cannot contradict each other:
 *
 *   customers   person-level      prospect -> active -> suspended/cancelled
 *   card_sales  commercial        draft -> ... -> activation_pending -> active
 *   payments    money movement    recorded -> verified | rejected | voided
 *   memberships the active card   active -> expired | suspended | cancelled
 *   commissions the 4% lifecycle  pending -> ... -> earned -> paid
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

export const customerStatusSchema = z.enum(['prospect', 'active', 'suspended', 'cancelled']);
export type CustomerStatus = z.infer<typeof customerStatusSchema>;

export const saleStatusSchema = z.enum([
  'draft',
  'submitted',
  'payment_pending',
  'payment_in_progress',
  'payment_verified',
  'activation_pending',
  'active',
  'cancelled',
  'overdue',
]);
export type SaleStatus = z.infer<typeof saleStatusSchema>;

export const paymentStatusSchema = z.enum(['recorded', 'verified', 'rejected', 'voided']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentTypeSchema = z.enum(['down_payment', 'installment', 'full']);
export type PaymentType = z.infer<typeof paymentTypeSchema>;

export const membershipStatusSchema = z.enum(['active', 'expired', 'suspended', 'cancelled']);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const commissionStatusSchema = z.enum([
  'pending',
  'payment_verified',
  'final_qualification_pending',
  'earned',
  'paid',
  'cancelled',
]);
export type CommissionStatus = z.infer<typeof commissionStatusSchema>;

/* ------------------------------------------------------------------ */
/* Official paper-form transaction lifecycles (single source)          */
/* ------------------------------------------------------------------ */

/**
 * Customer application = TRANSACTION HEADER. Explicit status, never
 * overlapping booleans. `submitted_at`/`approved_at`/`rejected_at` are the
 * authoritative instants; `updated_at` is never a substitute.
 */
export const customerApplicationStatusSchema = z.enum([
  'draft',
  'submitted',
  'approved',
  'rejected',
  'cancelled',
]);
export type CustomerApplicationStatus = z.infer<typeof customerApplicationStatusSchema>;

/**
 * IST reservation agreement = TRANSACTION HEADER. `submitted` is under review,
 * `executed` is the finalized contract. Schedule rows are obligations, never
 * received payments.
 */
export const reservationAgreementStatusSchema = z.enum([
  'draft',
  'submitted',
  'executed',
  'cancelled',
]);
export type ReservationAgreementStatus = z.infer<typeof reservationAgreementStatusSchema>;

export const pointsEntryTypeSchema = z.enum([
  'annual_allocation',
  'redemption',
  'adjustment',
  'reversal',
  'expiration',
]);
export type PointsEntryType = z.infer<typeof pointsEntryTypeSchema>;

export const hierarchyRoleSchema = z.enum([
  'vice_director',
  'senior_sales_manager',
  'sales_manager',
  'ost',
]);
export type HierarchyRole = z.infer<typeof hierarchyRoleSchema>;

/** Derived (never stored) state of the 7-day spot-cash window. */
export const spotCashStateSchema = z.enum([
  'not_started',
  'within_deadline',
  'expired',
  'fully_paid',
]);
export type SpotCashState = z.infer<typeof spotCashStateSchema>;

/* ------------------------------------------------------------------ */
/* VIP payment schemes (Stage 1 pre-opening value)                     */
/* ------------------------------------------------------------------ */

/**
 * Authoritative payment-scheme enumeration. Free-text scheme names are never
 * used for business enforcement: every sale freezes one of these values in
 * `card_sales.payment_scheme`, and the economics for the value come from the
 * plan row through `resolveSchemeEconomics` (api/_lib/commerce.ts).
 *
 * - `spot_cash`: standard Spot Cash price, settle within 7 days.
 * - `move_a`: same Spot Cash total; ₱10,000 reservation upfront, balance / 4.
 * - `installment_4_month`: standard 4-month installment total (different from
 *   Spot Cash); ₱10,000 reservation, balance / 4.
 * - `move_b1_40_12`: same installment total; 40% DP (reservation included),
 *   balance / 12. Silver/Gold only.
 * - `move_b2_25_12`: same installment total; 25% DP (reservation included),
 *   balance / 12. Silver/Gold only, only when B1 does not fit.
 */
export const paymentSchemeSchema = z.enum([
  'spot_cash',
  'move_a',
  'installment_4_month',
  'move_b1_40_12',
  'move_b2_25_12',
]);
export type PaymentScheme = z.infer<typeof paymentSchemeSchema>;

export const PAYMENT_SCHEMES: readonly PaymentScheme[] = [
  'spot_cash',
  'move_a',
  'installment_4_month',
  'move_b1_40_12',
  'move_b2_25_12',
];

/** User-facing labels. The client sends codes; labels are display only. */
export const PAYMENT_SCHEME_LABELS: Record<PaymentScheme, string> = {
  spot_cash: 'Spot Cash',
  move_a: 'Move A: Pay Over 4 Months',
  installment_4_month: '4-Month Installment',
  move_b1_40_12: 'Move B1: 40% DP + 12 Months',
  move_b2_25_12: 'Move B2: 25% DP + 12 Months',
};

export function paymentSchemeLabel(scheme: string): string {
  return (PAYMENT_SCHEMES as readonly string[]).includes(scheme)
    ? PAYMENT_SCHEME_LABELS[scheme as PaymentScheme]
    : scheme;
}

/**
 * Golden-rule transition guard (VIP rules 2-4).
 *
 * A sale's scheme is frozen at creation and there is no endpoint that changes
 * it, so the only legal "transition" is staying on the same scheme. In
 * particular Move A may never chain into B1/B2. This validator pins that rule
 * wherever a transition could ever be contemplated, so the rule is tested
 * rather than implied.
 */
export type SchemeTransitionRejection = 'SCHEME_FROZEN' | 'MOVE_A_CANNOT_CHAIN';

export function validateSchemeTransition(
  from: PaymentScheme,
  to: PaymentScheme,
): { ok: true } | { error: SchemeTransitionRejection } {
  if (from === to) return { ok: true };
  if (from === 'move_a' && (to === 'move_b1_40_12' || to === 'move_b2_25_12')) {
    return { error: 'MOVE_A_CANNOT_CHAIN' };
  }
  return { error: 'SCHEME_FROZEN' };
}

/** The legal order of the selling hierarchy, upline -> downline. */
export const HIERARCHY_ORDER: readonly HierarchyRole[] = [
  'vice_director',
  'senior_sales_manager',
  'sales_manager',
  'ost',
];

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

const CUSTOMER_TRANSITIONS: Record<CustomerStatus, readonly CustomerStatus[]> = {
  prospect: ['active', 'suspended', 'cancelled'],
  active: ['suspended', 'cancelled'],
  suspended: ['active', 'cancelled'],
  cancelled: [],
};

const SALE_TRANSITIONS: Record<SaleStatus, readonly SaleStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['payment_pending', 'cancelled'],
  payment_pending: ['payment_in_progress', 'payment_verified', 'overdue', 'cancelled'],
  payment_in_progress: ['payment_verified', 'overdue', 'cancelled'],
  overdue: ['payment_in_progress', 'payment_verified', 'cancelled'],
  payment_verified: ['activation_pending', 'cancelled'],
  activation_pending: ['active', 'cancelled'],
  active: [],
  cancelled: [],
};

const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  recorded: ['verified', 'rejected', 'voided'],
  verified: [],
  rejected: [],
  voided: [],
};

const MEMBERSHIP_TRANSITIONS: Record<MembershipStatus, readonly MembershipStatus[]> = {
  active: ['expired', 'suspended', 'cancelled'],
  expired: ['active', 'cancelled'],
  suspended: ['active', 'cancelled'],
  cancelled: [],
};

const COMMISSION_TRANSITIONS: Record<CommissionStatus, readonly CommissionStatus[]> = {
  pending: ['payment_verified', 'cancelled'],
  payment_verified: ['final_qualification_pending', 'cancelled'],
  // 'earned' is reachable only by an explicit qualification decision. The rule
  // that permits it is NOT defined in this codebase - see AGENTS.md.
  final_qualification_pending: ['earned', 'cancelled'],
  earned: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

const CUSTOMER_APPLICATION_TRANSITIONS: Record<
  CustomerApplicationStatus,
  readonly CustomerApplicationStatus[]
> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'rejected', 'cancelled', 'draft'],
  approved: ['cancelled'],
  rejected: ['draft', 'cancelled'],
  cancelled: [],
};

const RESERVATION_AGREEMENT_TRANSITIONS: Record<
  ReservationAgreementStatus,
  readonly ReservationAgreementStatus[]
> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['executed', 'cancelled', 'draft'],
  executed: [],
  cancelled: [],
};

function canTransition<T extends string>(table: Record<T, readonly T[]>, from: T, to: T): boolean {
  return (table[from] ?? []).includes(to);
}

export const canTransitionCustomer = (f: CustomerStatus, t: CustomerStatus) =>
  canTransition(CUSTOMER_TRANSITIONS, f, t);
export const canTransitionSale = (f: SaleStatus, t: SaleStatus) =>
  canTransition(SALE_TRANSITIONS, f, t);
export const canTransitionPayment = (f: PaymentStatus, t: PaymentStatus) =>
  canTransition(PAYMENT_TRANSITIONS, f, t);
export const canTransitionMembership = (f: MembershipStatus, t: MembershipStatus) =>
  canTransition(MEMBERSHIP_TRANSITIONS, f, t);
export const canTransitionCommission = (f: CommissionStatus, t: CommissionStatus) =>
  canTransition(COMMISSION_TRANSITIONS, f, t);
export const canTransitionCustomerApplication = (
  f: CustomerApplicationStatus,
  t: CustomerApplicationStatus,
) => canTransition(CUSTOMER_APPLICATION_TRANSITIONS, f, t);
export const canTransitionReservationAgreement = (
  f: ReservationAgreementStatus,
  t: ReservationAgreementStatus,
) => canTransition(RESERVATION_AGREEMENT_TRANSITIONS, f, t);

/** States a sale may still receive money in. */
export const SALE_ACCEPTS_PAYMENT: readonly SaleStatus[] = [
  'submitted',
  'payment_pending',
  'payment_in_progress',
  'overdue',
];

/** States in which a verified payment total may mark the sale fully paid. */
export const SALE_AWAITING_FULL_PAYMENT: readonly SaleStatus[] = [
  'draft',
  'submitted',
  'payment_pending',
  'payment_in_progress',
  'overdue',
];

/** States from which activation is allowed. Full payment is re-checked in the RPC. */
export const SALE_ACTIVATABLE: readonly SaleStatus[] = ['payment_verified', 'activation_pending'];

/** True when the hierarchy level may legitimately sit under `upline`. */
export function hierarchyAllowsUpline(subject: HierarchyRole, upline: HierarchyRole): boolean {
  const s = HIERARCHY_ORDER.indexOf(subject);
  const u = HIERARCHY_ORDER.indexOf(upline);
  return s >= 0 && u >= 0 && u === s - 1;
}
