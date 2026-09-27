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

export const customerStatusSchema = z.enum([
  'prospect',
  'active',
  'suspended',
  'cancelled',
]);
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

export const membershipStatusSchema = z.enum([
  'active',
  'expired',
  'suspended',
  'cancelled',
]);
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

function canTransition<T extends string>(
  table: Record<T, readonly T[]>,
  from: T,
  to: T,
): boolean {
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
export function hierarchyAllowsUpline(
  subject: HierarchyRole,
  upline: HierarchyRole,
): boolean {
  const s = HIERARCHY_ORDER.indexOf(subject);
  const u = HIERARCHY_ORDER.indexOf(upline);
  return s >= 0 && u >= 0 && u === s - 1;
}
