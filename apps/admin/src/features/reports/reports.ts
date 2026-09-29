/**
 * Phase 15 Reports and Audit Center admin surface.
 *
 * Which reports a caller may SEE is decided here (UX only, from the session's
 * effective permissions); which rows they may READ is decided by the server on
 * every request. The two tables below must stay consistent with the server's
 * `REPORT_MODULES` gate in `api/_handlers/reports.ts` - the server is
 * authoritative when they disagree.
 */
import type { AfHomesModuleKey } from '@jad/contracts';

export type ReportColumn = { key: string; label: string };

export type ReportDef = {
  type: string;
  label: string;
  description: string;
  /** Viewer needs ANY of these module views (mirrors the server gate). */
  modules: AfHomesModuleKey[];
  columns: ReportColumn[];
};

export const REPORT_DEFS: ReportDef[] = [
  {
    type: 'sales',
    label: 'Sales',
    description: 'Frozen sale snapshots with verified-paid and remaining amounts.',
    modules: ['sales.card_sales'],
    columns: [
      { key: 'saleNumber', label: 'Sale number' },
      { key: 'date', label: 'Date' },
      { key: 'customer', label: 'Customer' },
      { key: 'seller', label: 'Seller' },
      { key: 'plan', label: 'Card plan' },
      { key: 'paymentScheme', label: 'Payment scheme' },
      { key: 'frozenPrice', label: 'Frozen price' },
      { key: 'reservationFee', label: 'Reservation fee' },
      { key: 'requiredDown', label: 'Required initial' },
      { key: 'installmentMonths', label: 'Months' },
      { key: 'monthlyAmount', label: 'Monthly amount' },
      { key: 'verifiedPaid', label: 'Verified paid' },
      { key: 'remaining', label: 'Remaining' },
      { key: 'status', label: 'Status' },
    ],
  },
  {
    type: 'customers',
    label: 'Customers',
    description: 'Safe customer fields only - no government IDs, ever.',
    modules: ['sales.customers'],
    columns: [
      { key: 'customerNumber', label: 'Customer number' },
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'status', label: 'Status' },
      { key: 'registeredAt', label: 'Registered' },
      { key: 'seller', label: 'Seller / referrer' },
      { key: 'membershipStatus', label: 'Membership' },
      { key: 'plan', label: 'Plan' },
    ],
  },
  {
    type: 'payments',
    label: 'Payments',
    description: 'Only verified payments count toward received-money totals.',
    modules: ['finance.payment_verification'],
    columns: [
      { key: 'paymentDate', label: 'Payment date' },
      { key: 'saleNumber', label: 'Sale number' },
      { key: 'customer', label: 'Customer' },
      { key: 'amount', label: 'Amount' },
      { key: 'method', label: 'Method' },
      { key: 'status', label: 'Status' },
      { key: 'verifier', label: 'Verifier' },
      { key: 'verifiedAt', label: 'Verified at' },
    ],
  },
  {
    type: 'memberships',
    label: 'Activations / Memberships',
    description: 'Activation state and card issuance - never credentials.',
    modules: ['finance.card_activation', 'operations.redemption', 'sales.customers'],
    columns: [
      { key: 'membershipNumber', label: 'Membership' },
      { key: 'customer', label: 'Customer' },
      { key: 'tier', label: 'Tier' },
      { key: 'activatedAt', label: 'Activated' },
      { key: 'status', label: 'Status' },
      { key: 'pointsAllocated', label: 'Points allocated' },
      { key: 'cardIssuedAt', label: 'Card issued' },
      { key: 'printCount', label: 'Prints' },
    ],
  },
  {
    type: 'commissions',
    label: 'Commissions',
    description: 'Lifecycle states only - no payout projection.',
    modules: ['network.commissions', 'finance.commission_payouts'],
    columns: [
      { key: 'saleNumber', label: 'Sale number' },
      { key: 'beneficiary', label: 'Seller / OST' },
      { key: 'basePrice', label: 'Base price' },
      { key: 'rate', label: 'Rate' },
      { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' },
      { key: 'earnedAt', label: 'Earned' },
      { key: 'paidAt', label: 'Paid' },
    ],
  },
  {
    type: 'redemptions',
    label: 'Redemptions',
    description: 'Points spent as loyalty units, never currency.',
    modules: ['operations.redemption'],
    columns: [
      { key: 'redemptionNumber', label: 'Redemption' },
      { key: 'timestamp', label: 'Timestamp' },
      { key: 'customer', label: 'Customer' },
      { key: 'item', label: 'Item' },
      { key: 'quantity', label: 'Qty' },
      { key: 'pointsSpent', label: 'Points spent' },
      { key: 'actor', label: 'Staff' },
      { key: 'balanceAfter', label: 'Balance after' },
    ],
  },
  {
    type: 'genealogy',
    label: 'Genealogy / Team',
    description: 'Current structure with frozen historical sales attribution.',
    modules: ['network.genealogy'],
    columns: [
      { key: 'seller', label: 'Seller' },
      { key: 'role', label: 'Role' },
      { key: 'status', label: 'Status' },
      { key: 'upline', label: 'Current upline' },
      { key: 'directDownline', label: 'Direct' },
      { key: 'totalDescendants', label: 'Descendants' },
      { key: 'historicalSales', label: 'Hist. sales' },
      { key: 'historicalValue', label: 'Hist. value' },
    ],
  },
  {
    type: 'ost',
    label: 'OST Applications / Members',
    description: 'Sponsor-scoped applications and members.',
    modules: ['network.ost_registrations', 'network.ost_members'],
    columns: [
      { key: 'applicant', label: 'Applicant' },
      { key: 'sponsor', label: 'Sponsor' },
      { key: 'status', label: 'Status' },
      { key: 'submittedAt', label: 'Submitted' },
      { key: 'reviewedAt', label: 'Reviewed' },
    ],
  },
  {
    type: 'points',
    label: 'Points Ledger',
    description: 'Append-only ledger - no expiry or monetary value inferred.',
    modules: ['finance.points'],
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'membershipNumber', label: 'Membership' },
      { key: 'customer', label: 'Customer' },
      { key: 'entryType', label: 'Entry type' },
      { key: 'amount', label: 'Points' },
      { key: 'balanceAfter', label: 'Balance after' },
      { key: 'reference', label: 'Reference' },
    ],
  },
  {
    type: 'plans',
    label: 'Card Plans',
    description: 'Reference plans with in-scope sales counts.',
    modules: ['sales.card_plans'],
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'cashPrice', label: 'Spot cash price' },
      { key: 'installmentPrice', label: 'Installment price' },
      { key: 'reservationFee', label: 'Reservation fee' },
      { key: 'validityYears', label: 'Validity (years)' },
      { key: 'yearlyPoints', label: 'Yearly points' },
      { key: 'isActive', label: 'Active' },
      { key: 'scopedSales', label: 'Sales in scope' },
      { key: 'scopedValue', label: 'Value in scope' },
    ],
  },
];

export function availableReports(
  permissions: readonly { moduleKey: AfHomesModuleKey; canView: boolean }[] | undefined,
): ReportDef[] {
  return REPORT_DEFS.filter((def) =>
    def.modules.some((key) => permissions?.some((p) => p.moduleKey === key && p.canView) === true),
  );
}
