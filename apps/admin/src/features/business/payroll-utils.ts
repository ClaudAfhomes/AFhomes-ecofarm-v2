import type { SessionUser } from '../../lib/session';

const manilaParts = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // "2026-11-13"

/** Today in Asia/Manila as `YYYY-MM-DD`. */
export const manilaToday = (now = new Date()): string => manilaParts(now);

/** Current month (Asia/Manila) first, then the 11 before it, as `YYYY-MM`. */
export function payrollMonthOptions(now = new Date()): string[] {
  const [y, m] = manilaParts(now).split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const index = y * 12 + (m - 1) - i;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}

export const payrollMonthLabel = (period: string): string => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

/** UX-only permission read; the server re-checks every action. */
export const hasPayrollPermission = (
  user: SessionUser | null | undefined,
  moduleKey:
    | 'finance.payroll'
    | 'finance.payroll_approval'
    | 'finance.payroll_close'
    | 'finance.payroll_policy'
    | 'finance.payroll_policy_approval',
  action: 'canView' | 'canCreate' | 'canUpdate',
): boolean => user?.afHomesPermissions.some((p) => p.moduleKey === moduleKey && p[action]) ?? false;

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : 'The request failed.';

export const REASON_MIN = 5;
export const LIVE_LOCKED_REASON =
  'Live payroll is not authorized by the server. You can run labelled simulations.';

/** Banner text for the Q1 decision; null when the gate says nothing to qualify. */
export function q1BannerText(gate: {
  q1Source: 'owner_reported' | 'approval_document' | null;
  q1EvidenceStatus: 'awaiting_evidence' | 'evidence_on_file' | null;
  q1EffectiveDate: string | null;
}): string | null {
  if (gate.q1Source === 'owner_reported') {
    return `Compensation model: Option C (both models) — owner-reported, ${
      gate.q1EvidenceStatus === 'evidence_on_file' ? 'evidence on file' : 'evidence awaited'
    }, ${gate.q1EffectiveDate ? `effective ${gate.q1EffectiveDate}` : 'no effective date'}.`;
  }
  return null;
}

export const REVIEW_FLAG_LABEL: Record<string, string> = {
  BA_ABOVE_REVIEW_LIMIT: 'BA is above the review limit',
  PA_ABOVE_REVIEW_LIMIT: 'PA is above the review limit',
  PB_ABOVE_REVIEW_LIMIT: 'PB is above the review limit',
  NET_ABOVE_REVIEW_LIMIT: 'Net pay is above the review limit',
  BA_ABOVE_POLICY_AMOUNT: 'BA is above the policy amount',
  PA_ABOVE_POLICY_AMOUNT: 'PA is above the policy amount',
};
export const reviewFlagLabel = (flag: string): string =>
  REVIEW_FLAG_LABEL[flag] ?? flag.replace(/_/g, ' ').toLowerCase();

/** Performance blocker codes in plain language. Codes are open strings: unknown ones fall back. */
export const PERFORMANCE_BLOCKER_LABEL: Record<string, string> = {
  RULE_NOT_APPROVED: 'No performance rule is approved for this month.',
  RULE_CHANGES_WITHIN_PERIOD:
    'The approved performance rule changes inside this month and no split rule exists.',
  RULE_INCOMPLETE: 'The approved performance rule leaves a required choice undecided.',
  GENEALOGY_NOT_EFFECTIVE_DATED:
    'Team attribution cannot be reconstructed because genealogy has no effective dates.',
  ASSUMED_CREDIT_BASE_NOT_DEFINED:
    'An assumed-credit rate is set but no approved base exists to apply it to.',
  NO_STAFF_SELLER: 'A verified payment has no staff seller of record.',
  IMPORTED_SALE_TREATMENT_NOT_APPROVED: 'Imported sales have no approved treatment for credit.',
  COUNT_DATE_MISSING: 'A verified payment has no count date.',
  OUTSIDE_COUNT_PERIOD: 'A verified payment counts outside this month.',
  MISSING_ENGAGEMENT: 'No approved IST engagement (contract start) exists for this staff member.',
  OUTSIDE_ENGAGEMENT_WINDOW: 'A payment falls outside the approved engagement window.',
  ENGAGEMENT_SUSPENDED: 'A payment is dated on or after the suspension and no rule covers it.',
  ENGAGEMENT_RANK_MISMATCH: 'The engagement rank differs from the staff member role.',
  ENGAGEMENT_CHANGES_WITHIN_PERIOD:
    'More than one engagement covers this month and no split rule exists.',
  CONTRACT_SNAPSHOT_MISMATCH: 'The sale and its reservation disagree on seller or contract price.',
  CONTRACT_PRICE_SNAPSHOT_MISSING:
    'The contract has no frozen price snapshot, so the closed-deal threshold cannot be applied.',
  EVIDENCE_UNDETERMINED: 'A payment on the evidence list could not be classified.',
  EVIDENCE_TOTAL_MISMATCH: 'The evidence items do not add up to the month figures.',
  EVIDENCE_CHANGED: 'The evidence changed while the draft was being prepared; generate again.',
  PERFORMANCE_EVIDENCE_MISSING: 'No performance figures exist for this staff member.',
  MISSING_CONTRACT_START: 'No contract start is recorded.',
};
export const performanceBlockerLabel = (code: string): string =>
  PERFORMANCE_BLOCKER_LABEL[code] ?? code;

export const ATTRIBUTION_LABEL = {
  seller_only: 'Seller only',
  team_genealogy: 'Team (genealogy)',
} as const;
export const COUNT_DATE_LABEL = {
  verified_posting_period: 'Verified posting period',
  paid_on: 'Paid-on date',
} as const;

export const RANK_LABEL = {
  SM: 'Sales Manager',
  SSM: 'Senior Sales Manager',
  SVD: 'Sales Vice Director',
} as const;
