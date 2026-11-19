/**
 * Shared plumbing for the AFHomes API handlers.
 *
 * Keeps the sub-path dispatch, error envelope, audit insert, and JSON body
 * reading in one place so every Phase 2 handler behaves identically: same error
 * shape, same audit semantics, same "never leak the driver message" rule.
 */
import { toErrorEnvelope } from './envelope.js';
import type { VercelRequest, VercelResponse } from './http.js';

// Supabase's fluent query type stays behind this server-only adapter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;

export type FailureCode = Parameters<typeof toErrorEnvelope>[0];

export function fail(
  res: VercelResponse,
  code: FailureCode,
  message: string,
  status: number,
  details?: unknown,
): void {
  const envelope = toErrorEnvelope(code, message, status, details);
  res.status(envelope.status).json({ error: envelope.error });
}

export function list(res: VercelResponse, data: unknown[]): void {
  res.status(200).json({ data, meta: { total: data.length } });
}

/** The shape `authorizeAfHomes`/`resolveAfHomesPrincipal` return on failure. */
export type Denied = { error: { error: { code: string; message: string }; status: number } };

/**
 * Relay an authorization denial using its own status and envelope, so the
 * client sees the resolver's code (401 vs 403) rather than a flattened one.
 */
export function deny(res: VercelResponse, denied: Denied): void {
  res.status(denied.error.status).json({ error: denied.error.error });
}

/**
 * The sub-path a family handler is dispatching on, e.g. `sales` -> `42/payments`.
 *
 * CANONICAL ROUTING CONTRACT (Phase 13): the sub-path NEVER carries the family
 * prefix. The router strips `/api/v1/<family>/` before dispatch, so a handler
 * matches `42/payments` - never `sales/42/payments`. The collection root is
 * always `''`. The single exception is an exact-path family (`auth`), whose
 * configured full path passes through unchanged.
 *
 * Handler tests must pass the same stripped paths production sends; a test
 * that passes a prefixed path is testing a request that cannot exist.
 */
export function subPath(req: VercelRequest): string {
  return String(req.query.familyPath ?? '').replace(/^\/+|\/+$/g, '');
}

export function method(req: VercelRequest): string {
  return req.method ?? 'GET';
}

/** True when the request matches `VERB /pattern`; captures params on success. */
export function route(req: VercelRequest, verb: string, pattern: RegExp): RegExpMatchArray | null {
  if (method(req) !== verb.toUpperCase()) return null;
  return subPath(req).match(pattern);
}

/**
 * Append an audit event. Throws on failure on purpose: a business mutation that
 * cannot be audited must not be reported as a success.
 */
export async function audit(
  db: Db,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
  extra?: { reason?: string; requestId?: string },
): Promise<void> {
  const { error } = await db.from('audit_events').insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_data: before ?? null,
    after_data: after ?? null,
    reason: extra?.reason ?? null,
    request_id: extra?.requestId ?? null,
  });
  if (error) throw new Error(`Audit write failed: ${error.message}`);
}

/**
 * IST engagements and performance rules (20270105000009) raise one code family per
 * kind (PREFIX_NOT_FOUND, PREFIX_INVALID, ...). Built once so both kinds stay identical.
 */
const IST_GOVERNED_KINDS = [
  ['IST_ENGAGEMENT', 'engagement'],
  ['IST_PERFORMANCE_RULE', 'performance rule'],
] as const;
const IST_GOVERNED_SUFFIXES: Record<string, [FailureCode, number, (noun: string) => string]> = {
  NOT_FOUND: ['NOT_FOUND', 404, (n) => `IST ${n} not found.`],
  INVALID: ['VALIDATION_ERROR', 400, (n) => `The IST ${n} has an invalid value.`],
  NOT_EDITABLE: ['CONFLICT', 409, (n) => `Only a draft ${n} can be edited.`],
  NOT_PENDING: ['CONFLICT', 409, (n) => `This ${n} is not waiting for approval.`],
  NOT_APPROVED: ['CONFLICT', 409, (n) => `Only an approved ${n} can be ended.`],
  TRANSITION_INVALID: ['CONFLICT', 409, (n) => `That change is not allowed for this ${n} status.`],
  IMMUTABLE: ['CONFLICT', 409, (n) => `An approved ${n} cannot be changed that way; each end or suspension date is set once.`],
  IN_USE_BY_FINALIZED_PAYROLL: ['CONFLICT', 409, (n) => `This ${n} already backs an approved or closed payroll month, so it cannot be changed that way.`],
  OVERLAP: ['CONFLICT', 409, (n) => `This ${n} overlaps an approved one. End the earlier one first.`],
  IDEMPOTENCY_CONFLICT: ['CONFLICT', 409, () => 'This request identifier was already used with different data.'],
  SELF_APPROVAL: ['FORBIDDEN', 403, (n) => `Whoever drafted, edited or submitted a ${n} cannot approve it.`],
  DIRECT_WRITE_REFUSED: ['FORBIDDEN', 403, (n) => `An IST ${n} can only be changed through its workflow.`],
  EVIDENCE_REQUIRED: ['VALIDATION_ERROR', 400, () => 'Enter the reference of the approval document (10 to 500 characters).'],
  APPROVAL_NOTE_REQUIRED: ['VALIDATION_ERROR', 400, () => 'Give an approval note of at least 5 characters.'],
  RETURN_REASON_REQUIRED: ['VALIDATION_ERROR', 400, (n) => `Give a reason of at least 5 characters for returning the ${n}.`],
  END_NOTE_REQUIRED: ['VALIDATION_ERROR', 400, (n) => `Give a note of at least 5 characters for ending the ${n}.`],
  END_DATE_INVALID: ['VALIDATION_ERROR', 400, (n) => `The end date must be a real date inside the ${n} window.`],
};
const IST_GOVERNED_STATUS: Record<string, [FailureCode, number]> = {};
const IST_GOVERNED_MESSAGES: Record<string, string> = {};
for (const [prefix, noun] of IST_GOVERNED_KINDS)
  for (const [suffix, [failure, status, text]] of Object.entries(IST_GOVERNED_SUFFIXES)) {
    IST_GOVERNED_STATUS[`${prefix}_${suffix}`] = [failure, status];
    IST_GOVERNED_MESSAGES[`${prefix}_${suffix}`] = text(noun);
  }
/**
 * Extra IST governed codes (e.g. rule-succession refusals). Add one line per code here;
 * they flow into both the status table and the message table.
 */
const IST_GOVERNED_EXTRA: Record<string, [FailureCode, number, string]> = {
  IST_PERFORMANCE_RULE_INCOMPLETE: [
    'CONFLICT',
    409,
    'Complete the performance rule choices before approval. Record the attribution, closed-deal threshold, count-date basis and adjustment treatment.',
  ],
  PERFORMANCE_RULE_TRANSITION_RULE_NOT_APPROVED: [
    'CONFLICT',
    409,
    'This rule changes the threshold, count date, attribution or adjustment treatment of an approved rule. Changing those needs an approved transition rule (Presidential decision), which is pending. Nothing was changed.',
  ],
  PERFORMANCE_RULE_SUCCESSION_NOT_IMPLEMENTED: [
    'CONFLICT',
    409,
    'A performance rule with a different shape cannot succeed an approved rule yet: split crediting is not built. Nothing was changed.',
  ],
};
for (const [code, [failure, status, text]] of Object.entries(IST_GOVERNED_EXTRA)) {
  IST_GOVERNED_STATUS[code] = [failure, status];
  IST_GOVERNED_MESSAGES[code] = text;
}
const IST_INVALID_CODES = new Set(IST_GOVERNED_KINDS.map(([prefix]) => `${prefix}_INVALID`));

/**
 * Map a Postgres RPC error onto a client error. The raw driver message is
 * logged server-side only - it can name relations, columns, and constraints.
 */
export function mapRpcError(
  res: VercelResponse,
  error: { message?: string; code?: string; details?: string } | null,
): void {
  const message = String(error?.message ?? '');
  const [code] = message.split(':');

  const byCode: Record<string, [FailureCode, number]> = {
    OFFICIAL_RA_YEAR_EXHAUSTED: ['CONFLICT', 409],
    OFFICIAL_RA_NUMBER_IMMUTABLE: ['CONFLICT', 409],
    VIP_RA_NUMBER_COLLISION: ['CONFLICT', 409],
    VIP_OFFICIAL_RA_SEQUENCE_REQUIRED: ['CONFLICT', 409],
    VIP_FINALIZED_RESERVATION_REQUIRED: ['CONFLICT', 409],
    VIP_VERIFIED_ACTIVATION_REQUIRED: ['CONFLICT', 409],
    VIP_ACTIVATION_CONTEXT_REQUIRED: ['CONFLICT', 409],
    IMPORT_VIP_EXISTING_NUMBER_REQUIRED: ['CONFLICT', 409],
    STAY_SERVICE_DATES_REQUIRED: ['VALIDATION_ERROR', 400],
    INSUFFICIENT_DAY_ALLOWANCE: ['CONFLICT', 409],
    LEGACY_REDEMPTION_DATES_REQUIRED: ['CONFLICT', 409],
    IMPORT_MEMBERSHIP_DATES_REQUIRED: ['CONFLICT', 409],
    IMPORT_MEMBERSHIP_DATES_CONFLICT: ['CONFLICT', 409],
    IMPORT_MEMBERSHIP_HISTORY_CONFLICT: ['CONFLICT', 409],
    IMPORT_POINTS_BASELINE_CONFLICT: ['CONFLICT', 409],
    IMPORT_POINTS_EXISTING_HISTORY_REVIEW_REQUIRED: ['CONFLICT', 409],
    IMPORT_VIP_NUMBER_CONFLICT: ['CONFLICT', 409],
    IMPORT_VIP_NUMBER_FORMAT_CONFLICT: ['VALIDATION_ERROR', 400],
    IMPORT_VIP_TERM_CONFLICT: ['CONFLICT', 409],
    IMPORT_VIP_CLASSIFICATION_UNSUPPORTED: ['CONFLICT', 409],
    IMPORT_VIP_CLASSIFICATION_CONFLICT: ['CONFLICT', 409],
    IMPORT_VIP_CLASSIFICATION_INVALID: ['VALIDATION_ERROR', 400],
    IMPORT_VIP_EXISTING_EVIDENCE_REQUIRED: ['CONFLICT', 409],
    VIP_CARD_NUMBER_IMMUTABLE: ['CONFLICT', 409],
    VIP_CARD_NUMBER_ALREADY_ISSUED: ['CONFLICT', 409],
    IMPORT_TARGET_CHANGED: ['CONFLICT', 409],
    IMPORT_SOURCE_CHANGED: ['CONFLICT', 409],
    IMPORT_SOURCE_IDENTITY_CONFLICT: ['CONFLICT', 409],
    IMPORT_IDENTITY_REVIEW_REQUIRED: ['CONFLICT', 409],
    IMPORT_CUSTOMER_FIELD_CONFLICT: ['CONFLICT', 409],
    IMPORT_REFERRAL_CONFLICT: ['CONFLICT', 409],
    IMPORT_GENEALOGY_CONFLICT: ['CONFLICT', 409],
    IMPORT_UNKNOWN_CUSTOMER_ID: ['CONFLICT', 409],
    COMPANY_CUSTOMER_ID_RANGE_EXHAUSTED: ['CONFLICT', 409],
    IMPORT_SOURCE_FORBIDDEN: ['FORBIDDEN', 403],
    IMPORT_ROW_NOT_FOUND: ['NOT_FOUND', 404],
    IMPORT_CLAIM_NOT_FOUND: ['NOT_FOUND', 404],
    IMPORT_CLAIM_ALREADY_RECORDED: ['CONFLICT', 409],
    IMPORT_CLAIM_INVALID: ['VALIDATION_ERROR', 400],
    IMPORT_PURCHASE_REFERENCE_REQUIRED: ['VALIDATION_ERROR', 400],
    IMPORT_HISTORICAL_TERMS_REVIEW_REQUIRED: ['CONFLICT', 409],
    IMPORT_RESERVATION_REFERENCE_REVIEW_REQUIRED: ['CONFLICT', 409],
    IMPORT_STAFF_REVIEW_REQUIRED: ['CONFLICT', 409],
    IMPORT_APPLICATION_ALREADY_LINKED: ['CONFLICT', 409],
    IMPORT_PROOF_REQUIRED: ['CONFLICT', 409],
    IMPORT_PROOF_CHANGED: ['CONFLICT', 409],
    IMPORT_PAYMENT_MATCH_CONFLICT: ['CONFLICT', 409],
    IMPORT_PAYMENT_RECONCILIATION_REQUIRED: ['CONFLICT', 409],
    IMPORT_CLAIM_REJECTED: ['CONFLICT', 409],
    SALE_NOT_FOUND: ['NOT_FOUND', 404],
    PAYMENT_NOT_FOUND: ['NOT_FOUND', 404],
    ACTOR_REQUIRED: ['UNAUTHORIZED', 401],
    SALE_NOT_ACTIVATABLE: ['CONFLICT', 409],
    SALE_NOT_FULLY_PAID: ['CONFLICT', 409],
    SALE_NOT_ACCEPTING_PAYMENTS: ['CONFLICT', 409],
    SALE_HAS_NO_PRICE_SNAPSHOT: ['CONFLICT', 409],
    PAYMENT_NOT_PENDING: ['CONFLICT', 409],
    AMOUNT_MUST_BE_POSITIVE: ['VALIDATION_ERROR', 400],
    INVALID_PAYMENT_TYPE: ['VALIDATION_ERROR', 400],
    INVALID_DECISION: ['VALIDATION_ERROR', 400],
    INVALID_VALIDITY_MONTHS: ['VALIDATION_ERROR', 400],
    REASON_REQUIRED: ['VALIDATION_ERROR', 400],
    UPLINE_ALREADY_ASSIGNED: ['CONFLICT', 409],
    UPLINE_SELF_REFERENCE: ['VALIDATION_ERROR', 400],
    INVALID_HIERARCHY: ['VALIDATION_ERROR', 400],
    INVALID_HIERARCHY_DIRECTION: ['VALIDATION_ERROR', 400],
    SUBJECT_ROLE_MISMATCH: ['VALIDATION_ERROR', 400],
    GENEALOGY_CYCLE: ['VALIDATION_ERROR', 400],
    INSUFFICIENT_PERMISSION: ['FORBIDDEN', 403],
    SUBJECT_NOT_FOUND: ['NOT_FOUND', 404],
    UPLINE_NOT_FOUND: ['NOT_FOUND', 404],
    APPLICATION_NOT_FOUND: ['NOT_FOUND', 404],
    AGREEMENT_NOT_FOUND: ['NOT_FOUND', 404],
    PLAN_NOT_FOUND: ['NOT_FOUND', 404],
    ACTOR_INACTIVE: ['FORBIDDEN', 403],
    SECONDARY_HOLDER_GOLD_ONLY: ['VALIDATION_ERROR', 400],
    PRIMARY_HOLDER_REQUIRED: ['VALIDATION_ERROR', 400],
    APPLICATION_REVIEW_INCOMPLETE: ['VALIDATION_ERROR', 400],
    PRIMARY_SIGNATURE_REQUIRED: ['VALIDATION_ERROR', 400],
    SECONDARY_SIGNATURE_REQUIRED: ['VALIDATION_ERROR', 400],
    INVALID_AGREEMENT_ACTION: ['VALIDATION_ERROR', 400],
    RESERVATION_ORIGIN_INVALID: ['CONFLICT', 409],
    APPLICATION_NOT_EDITABLE: ['CONFLICT', 409],
    // Application-first purchase flow. A stale proposal is a CONFLICT, never a
    // silent accept of figures the reviewer never saw, and the review-required
    // state is a conflict too: the operator must confirm terms explicitly.
    PURCHASE_PROPOSAL_CHANGED: ['CONFLICT', 409],
    PURCHASE_TERMS_REVIEW_REQUIRED: ['CONFLICT', 409],
    PURCHASE_TERMS_VERSION_CONFLICT: ['CONFLICT', 409],
    APPLICATION_NOT_APPROVED: ['CONFLICT', 409],
    RESERVATION_ALREADY_EXISTS: ['CONFLICT', 409],
    APPLICATION_APPROVAL_FORBIDDEN: ['FORBIDDEN', 403],
    APPLICATION_APPROVAL_REQUIRED: ['CONFLICT', 409],
    APPLICATION_SUBMISSION_REQUIRED: ['CONFLICT', 409],
    LINKED_RESERVATION_REQUIRED: ['CONFLICT', 409],
    PURCHASE_HAS_PAYMENTS: ['CONFLICT', 409],
    PURCHASE_WORKFLOW_REQUIRED: ['CONFLICT', 409],
    RESERVATION_PAYMENT_REQUIRED: ['CONFLICT', 409],
    RESERVATION_FEE_MUST_MATCH_TERMS: ['VALIDATION_ERROR', 400],
    CURRENT_ID_DOCUMENT_REQUIRED: ['CONFLICT', 409],
    REVIEW_REASON_REQUIRED: ['VALIDATION_ERROR', 400],
    RESERVATION_FEE_INVALID: ['CONFLICT', 409],
    SCHEME_SCHEDULE_UNAVAILABLE: ['CONFLICT', 409],
    RESERVATION_NOT_EXECUTED: ['CONFLICT', 409],
    RESERVATION_FINALIZED: ['CONFLICT', 409],
    RESERVATION_NOT_FULLY_PAID: ['CONFLICT', 409],
    RESERVATION_UNDECIDED_PAYMENTS: ['CONFLICT', 409],
    RESERVATION_ALREADY_FINALIZED: ['CONFLICT', 409],
    APPLICATION_ALREADY_FINALIZED: ['CONFLICT', 409],
    SALE_ALREADY_EXISTS: ['CONFLICT', 409],
    SALE_REFERENCE_CONFLICT: ['CONFLICT', 409],
    PURCHASE_TERMS_IDENTITY_INVALID: ['CONFLICT', 409],
    // The partial unique index is the guard, so the domain answer comes from the
    // constraint name Postgres reports rather than from a second check in SQL.
    payments_reservation_reference_unique: ['CONFLICT', 409],
    REJECTION_REASON_REQUIRED: ['VALIDATION_ERROR', 400],
    CUSTOMER_NOT_ELIGIBLE: ['CONFLICT', 409],
    PLAN_NOT_ACTIVE: ['CONFLICT', 409],
    SELLER_INACTIVE: ['FORBIDDEN', 403],
    SELLER_ROLE_NOT_A_SELLER: ['FORBIDDEN', 403],
    SELLER_NOT_IN_YOUR_DOWNLINE: ['FORBIDDEN', 403],
    SELLER_OF_RECORD_MUST_BE_CREATOR: ['FORBIDDEN', 403],
    SELLER_OF_RECORD_REQUIRED: ['VALIDATION_ERROR', 400],
    SELLER_OF_RECORD_FROZEN: ['CONFLICT', 409],
    SALE_ORIGINATION_FORBIDDEN: ['FORBIDDEN', 403],
    AGREEMENT_NOT_EDITABLE: ['CONFLICT', 409],
    AGREEMENT_SALE_IMMUTABLE: ['CONFLICT', 409],
    INVALID_APPLICATION_TRANSITION: ['CONFLICT', 409],
    INVALID_AGREEMENT_TRANSITION: ['CONFLICT', 409],
    INVALID_CAPTURE_KIND: ['VALIDATION_ERROR', 400],
    SALE_COMPLETE_HIERARCHY_REQUIRED: ['CONFLICT', 409],
    SALE_HIERARCHY_TOO_DEEP: ['CONFLICT', 409],
    SALE_SELLER_REQUIRED: ['VALIDATION_ERROR', 400],
    SALE_SELLER_HIERARCHY_ROLE_REQUIRED: ['CONFLICT', 409],
    IMPORT_JOB_NOT_FOUND: ['NOT_FOUND', 404],
    IMPORT_JOB_NOT_COMMITTABLE: ['CONFLICT', 409],
    IMPORT_DUPLICATE_MEMBERSHIP: ['CONFLICT', 409],
    IMPORT_DUPLICATE_EMAIL: ['CONFLICT', 409],
    IMPORT_BAD_PAYMENT: ['VALIDATION_ERROR', 400],
    IMPORT_BAD_OPENING_BALANCE: ['VALIDATION_ERROR', 400],
    IMPORT_NOT_FULLY_PAID: ['CONFLICT', 409],
    // Purchase workflow (20261230*/20261231000001). Unmapped codes used to surface as a 500.
    SELLER_NOT_FOUND: ['FORBIDDEN', 403],
    OVERPAYMENT_NOT_ALLOWED: ['CONFLICT', 409],
    PURCHASE_FULLY_PAID: ['CONFLICT', 409],
    DOWN_PAYMENT_ALREADY_RECORDED: ['CONFLICT', 409],
    RESERVATION_FEE_ALREADY_RECORDED: ['CONFLICT', 409],
    RESERVATION_FEE_EXCEEDS_TERMS: ['VALIDATION_ERROR', 400],
    FULL_PAYMENT_MUST_SETTLE_BALANCE: ['VALIDATION_ERROR', 400],
    PAYMENT_PURPOSE_REQUIRED: ['VALIDATION_ERROR', 400],
    INVALID_PAYMENT_PURPOSE: ['VALIDATION_ERROR', 400],
    PAYMENT_TYPE_PURPOSE_MISMATCH: ['VALIDATION_ERROR', 400],
    RECEIPT_STORAGE_PATH_REQUIRED: ['VALIDATION_ERROR', 400],
    RECEIPT_STORAGE_PATH_REQUIRED_FOR_VERIFICATION: ['CONFLICT', 409],
    RECEIPT_STORAGE_OBJECT_NOT_FOUND: ['VALIDATION_ERROR', 400],
    VIP_CARD_ID_REQUIRED: ['CONFLICT', 409],
    VIP_APPLICATION_ORIGIN_REQUIRED: ['CONFLICT', 409],
    VIP_EXECUTED_AGREEMENT_REQUIRED: ['CONFLICT', 409],
    VIP_PAYMENT_RESERVATION_MISMATCH: ['CONFLICT', 409],
    ACTIVATION_AGREEMENT_NOT_FINALIZED: ['CONFLICT', 409],
    AGREEMENT_NOT_AWAITING_SIGNATURE: ['CONFLICT', 409],
    OFFICIAL_RA_ISSUANCE_IMMUTABLE: ['CONFLICT', 409],
    PURCHASE_DOCUMENT_IMMUTABLE: ['CONFLICT', 409],
    PURCHASE_TERMS_IMMUTABLE: ['CONFLICT', 409],
    SIGNED_APPLICATION_DOCUMENT_REQUIRED: ['CONFLICT', 409],
    SIGNED_RA_DOCUMENT_REQUIRED: ['CONFLICT', 409],
    SIGNED_DOCUMENT_ALREADY_REVIEWED: ['CONFLICT', 409],
    SIGNED_DOCUMENT_IMMUTABLE: ['CONFLICT', 409],
    SIGNED_DOCUMENT_PATH_CONFLICT: ['CONFLICT', 409],
    RECEIPT_ALREADY_USED: ['CONFLICT', 409],
    // Finance Phase 2 (20270105000002).
    PAYMENT_REFERENCE_REVIEW_REQUIRED: ['CONFLICT', 409],
    DUPLICATE_OR_NUMBER: ['CONFLICT', 409],
    DUPLICATE_REVIEW_NOTE_REQUIRED: ['VALIDATION_ERROR', 400],
    DUPLICATE_REVIEW_NOT_NEEDED: ['CONFLICT', 409],
    PAYMENT_DATE_INVALID: ['VALIDATION_ERROR', 400],
    PAYMENT_DETAILS_INVALID: ['VALIDATION_ERROR', 400],
    PAYMENT_NOT_VERIFIED: ['CONFLICT', 409],
    VERIFIED_PAYMENT_DETAILS_IMMUTABLE: ['CONFLICT', 409],
    FINANCIAL_HISTORY_PROTECTED: ['CONFLICT', 409],
    CUSTOMER_FINANCIAL_HISTORY_PROTECTED: ['CONFLICT', 409],
    SALE_FINANCIAL_DETAILS_IMMUTABLE: ['CONFLICT', 409],
    COMMISSION_FINANCIAL_DETAILS_IMMUTABLE: ['CONFLICT', 409],
    PAYMENT_ADJUSTMENT_KIND_INVALID: ['VALIDATION_ERROR', 400],
    PAYMENT_ADJUSTMENT_REASON_REQUIRED: ['VALIDATION_ERROR', 400],
    PAYMENT_ADJUSTMENT_EXCEEDS_PAYMENT: ['VALIDATION_ERROR', 400],
    PAYMENT_ADJUSTMENT_ALREADY_PROPOSED: ['CONFLICT', 409],
    PAYMENT_ADJUSTMENT_APPROVAL_NOT_AUTHORIZED: ['FORBIDDEN', 403],
    PAYMENT_ADJUSTMENT_HISTORY_IMMUTABLE: ['CONFLICT', 409],
    COMPENSATION_POLICY_IMMUTABLE: ['CONFLICT', 409],
    COMPENSATION_POLICY_OVERLAP: ['CONFLICT', 409],
    // Accounting periods (20270105000003).
    CLOSED_PERIOD_IMMUTABLE: ['CONFLICT', 409],
    PERIOD_INVALID: ['VALIDATION_ERROR', 400],
    PERIOD_NOT_FOUND: ['NOT_FOUND', 404],
    PERIOD_NOT_OPEN: ['CONFLICT', 409],
    PERIOD_NOT_READY: ['CONFLICT', 409],
    PERIOD_NOT_ENDED: ['CONFLICT', 409],
    PERIOD_OUT_OF_ORDER: ['CONFLICT', 409],
    PERIOD_SELF_APPROVAL: ['FORBIDDEN', 403],
    PERIOD_RETURN_REASON_REQUIRED: ['VALIDATION_ERROR', 400],
    // Commission operations (20270105000004).
    DRI_NOT_AUTHORIZED: ['FORBIDDEN', 403],
    COMMISSION_TYPE_IMMUTABLE: ['CONFLICT', 409],
    COMMISSION_WITHHELD: ['CONFLICT', 409],
    COMMISSION_NOT_FOUND: ['NOT_FOUND', 404],
    COMMISSION_NOT_HOLDABLE: ['CONFLICT', 409],
    COMMISSION_NOT_PAYABLE: ['CONFLICT', 409],
    COMMISSION_NOT_PAID: ['CONFLICT', 409],
    COMMISSION_HOLD_REASON_REQUIRED: ['VALIDATION_ERROR', 400],
    COMMISSION_PAYOUT_FAILURE_REASON_REQUIRED: ['VALIDATION_ERROR', 400],
    COMMISSION_PAYOUT_HISTORY_IMMUTABLE: ['CONFLICT', 409],
    COMMISSION_PAYOUT_NOT_FOUND: ['NOT_FOUND', 404],
    COMMISSION_PAYOUT_NOT_PAID: ['CONFLICT', 409],
    DUPLICATE_PAYOUT_REFERENCE: ['CONFLICT', 409],
    PAYOUT_REFERENCE_REQUIRED: ['VALIDATION_ERROR', 400],
    PAYOUT_REFERENCE_MISMATCH: ['CONFLICT', 409],
    COMMISSION_RECOVERY_ALREADY_PROPOSED: ['CONFLICT', 409],
    COMMISSION_RECOVERY_EXCEEDS_COMMISSION: ['VALIDATION_ERROR', 400],
    COMMISSION_RECOVERY_HISTORY_IMMUTABLE: ['CONFLICT', 409],
    COMMISSION_RECOVERY_NOT_FOUND: ['NOT_FOUND', 404],
    COMMISSION_RECOVERY_REASON_REQUIRED: ['VALIDATION_ERROR', 400],
    COMMISSION_RECOVERY_TRIGGER_INVALID: ['VALIDATION_ERROR', 400],
    // IST payroll (20270105000005). The governing gate is a CONFLICT (state), not a permission failure.
    IST_PAYROLL_NOT_AUTHORIZED: ['CONFLICT', 409],
    PAYROLL_SIMULATION_ONLY: ['CONFLICT', 409],
    PAYROLL_SIMULATION_BASIS_REQUIRED: ['VALIDATION_ERROR', 400],
    PAYROLL_MODE_INVALID: ['VALIDATION_ERROR', 400],
    GOVERNING_POLICY_LOCKED: ['CONFLICT', 409],
    PAYROLL_CONFIGURATION_REQUIRED: ['CONFLICT', 409],
    PAYROLL_EVIDENCE_CHANGED: ['CONFLICT', 409],
    PAYROLL_PROOF_REQUIRED: ['VALIDATION_ERROR', 400],
    PAYROLL_PROOF_CONFLICT: ['CONFLICT', 409],
    PAYROLL_RECONCILIATION_ALREADY_RECORDED: ['CONFLICT', 409],
    PAYROLL_RECONCILIATION_REQUIRED: ['CONFLICT', 409],
    FINANCIAL_EVIDENCE_BUSY: ['CONFLICT', 409],
    PAYROLL_BATCH_NOT_FOUND: ['NOT_FOUND', 404],
    PAYROLL_BATCH_NOT_EDITABLE: ['CONFLICT', 409],
    PAYROLL_BATCH_EMPTY: ['CONFLICT', 409],
    PAYROLL_BATCH_NOT_SUBMITTED: ['CONFLICT', 409],
    PAYROLL_SELF_APPROVAL: ['FORBIDDEN', 403],
    PAYROLL_RETURN_REASON_REQUIRED: ['VALIDATION_ERROR', 400],
    PAYROLL_BATCH_LOCKED: ['CONFLICT', 409],
    PAYROLL_BATCH_TRANSITION_INVALID: ['CONFLICT', 409],
    PAYROLL_DIRECT_WRITE_REFUSED: ['FORBIDDEN', 403],
    PAYROLL_LINE_INVALID: ['VALIDATION_ERROR', 400],
    PAYROLL_LINE_DUPLICATE: ['CONFLICT', 409],
    PAYROLL_LINE_IMMUTABLE: ['CONFLICT', 409],
    PAYROLL_LINE_NOT_FOUND: ['NOT_FOUND', 404],
    PAYROLL_LINE_NOT_PAYABLE: ['CONFLICT', 409],
    PAYROLL_BATCH_NOT_APPROVED: ['CONFLICT', 409],
    PAYROLL_AMOUNT_MISMATCH: ['VALIDATION_ERROR', 400],
    PAYROLL_METHOD_REQUIRED: ['VALIDATION_ERROR', 400],
    PAYROLL_LINE_ALREADY_DISBURSED: ['CONFLICT', 409],
    PAYROLL_DISBURSEMENT_IMMUTABLE: ['CONFLICT', 409],
    // Payroll close, simulation workflow and month-end readiness (20270105000006).
    PAYROLL_SELF_CLOSE: ['FORBIDDEN', 403],
    PAYROLL_BATCH_NOT_FULLY_DISBURSED: ['CONFLICT', 409],
    PAYROLL_NOT_SIMULATION: ['CONFLICT', 409],
    PERIOD_HAS_BLOCKERS: ['CONFLICT', 409],
    // Payment adjustment resolution (20270105000007). Q13 pending is a CONFLICT (state), not a permission failure.
    PAYMENT_ADJUSTMENT_AUTHORITY_PENDING: ['CONFLICT', 409],
    PAYMENT_ADJUSTMENT_NOT_FOUND: ['NOT_FOUND', 404],
    PAYMENT_ADJUSTMENT_DECISION_INVALID: ['VALIDATION_ERROR', 400],
    PAYMENT_ADJUSTMENT_NOTE_REQUIRED: ['VALIDATION_ERROR', 400],
    PAYMENT_ADJUSTMENT_ALREADY_RESOLVED: ['CONFLICT', 409],
    PAYMENT_ADJUSTMENT_SELF_DECISION: ['FORBIDDEN', 403],
    PAYMENT_ADJUSTMENT_DIRECT_WRITE_REFUSED: ['FORBIDDEN', 403],
    // Compensation policy lifecycle, Q1 owner-reported decision, line review (20270105000008).
    COMPENSATION_POLICY_NOT_FOUND: ['NOT_FOUND', 404],
    COMPENSATION_POLICY_INVALID: ['VALIDATION_ERROR', 400],
    COMPENSATION_POLICY_NOT_EDITABLE: ['CONFLICT', 409],
    COMPENSATION_POLICY_NOT_PENDING: ['CONFLICT', 409],
    COMPENSATION_POLICY_NOT_APPROVED: ['CONFLICT', 409],
    COMPENSATION_POLICY_TRANSITION_INVALID: ['CONFLICT', 409],
    COMPENSATION_POLICY_IN_USE_BY_FINALIZED_PAYROLL: ['CONFLICT', 409],
    COMPENSATION_POLICY_SELF_APPROVAL: ['FORBIDDEN', 403],
    COMPENSATION_POLICY_EVIDENCE_REQUIRED: ['VALIDATION_ERROR', 400],
    COMPENSATION_POLICY_APPROVAL_NOTE_REQUIRED: ['VALIDATION_ERROR', 400],
    COMPENSATION_POLICY_RETURN_REASON_REQUIRED: ['VALIDATION_ERROR', 400],
    COMPENSATION_POLICY_END_NOTE_REQUIRED: ['VALIDATION_ERROR', 400],
    COMPENSATION_POLICY_END_DATE_INVALID: ['VALIDATION_ERROR', 400],
    COMPENSATION_POLICY_DIRECT_WRITE_REFUSED: ['FORBIDDEN', 403],
    POLICY_TRANSITION_RULE_NOT_APPROVED: ['CONFLICT', 409],
    // Raised with SQLSTATE 23505; listed here so the generic unique-violation fallback never swallows it.
    COMPENSATION_POLICY_IDEMPOTENCY_CONFLICT: ['CONFLICT', 409],
    POLICY_SEGMENT_PAYOUT_NOT_IMPLEMENTED: ['CONFLICT', 409],
    // IST engagements and performance rules (20270105000009).
    ...IST_GOVERNED_STATUS,
    IST_GOVERNED_KIND_INVALID: ['VALIDATION_ERROR', 400],
    IST_GOVERNED_ACTION_INVALID: ['VALIDATION_ERROR', 400],
    STAFF_REQUIRED: ['VALIDATION_ERROR', 400],
    PAYROLL_LINE_REVIEW_REQUIRED: ['CONFLICT', 409],
    PAYROLL_LINE_REVIEW_NOT_REQUIRED: ['CONFLICT', 409],
    PAYROLL_LINE_ALREADY_REVIEWED: ['CONFLICT', 409],
    PAYROLL_REVIEW_NOTE_REQUIRED: ['VALIDATION_ERROR', 400],
    IMPORT_BATCH_LIMIT: ['VALIDATION_ERROR', 400],
    VIP_CARD_NUMBER_RANGE_EXHAUSTED: ['CONFLICT', 409],
    SELLER_OF_RECORD_MUST_BE_SM: ['FORBIDDEN', 403],
    IMPORT_DUPLICATE_VIP_CARD_NUMBER: ['CONFLICT', 409],
    IMPORT_SELLER_SM_REQUIRED: ['CONFLICT', 409],
    IMPORT_SELLER_TEAM_CONFLICT: ['CONFLICT', 409],
    SIGNED_DOCUMENT_NOT_FOUND: ['NOT_FOUND', 404],
    SIGNED_DOCUMENT_OBJECT_NOT_FOUND: ['VALIDATION_ERROR', 400],
    SIGNED_DOCUMENT_KIND_INVALID: ['VALIDATION_ERROR', 400],
    SIGNED_DOCUMENT_PATH_INVALID: ['VALIDATION_ERROR', 400],
    ORIGINAL_FILENAME_REQUIRED: ['VALIDATION_ERROR', 400],
    INVALID_FILE_SIZE: ['VALIDATION_ERROR', 400],
    INVALID_MIME_TYPE: ['VALIDATION_ERROR', 400],
  };

  if (code === 'MUTATION_PAYLOAD_CONFLICT')
    return fail(
      res,
      'CONFLICT',
      'This request identifier was already used with different data.',
      409,
    );
  // A concurrent payout with the same bank reference loses the race at the
  // unique index rather than at the RPC's own duplicate check.
  if (
    message.includes('payroll_disbursements_reference_unique') ||
    message.includes('payroll_simulation_disbursements_batch_reference_unique') ||
    message.includes('commission_payouts_reference_unique')
  )
    return fail(res, 'CONFLICT', 'This bank reference is already used on another payout.', 409);
  if (message.includes('payments_sale_reference_unique'))
    return fail(
      res,
      'CONFLICT',
      'This payment reference has already been recorded for this sale.',
      409,
    );
  if (code === 'MUTATION_FORBIDDEN')
    return fail(res, 'FORBIDDEN', 'This operation is not authorized', 403);
  if (code === 'MUTATION_REQUEST_REQUIRED' || code === 'INVALID_DOCUMENT_REVIEW')
    return fail(
      res,
      'VALIDATION_ERROR',
      'A valid request identity and mutation data are required',
      400,
    );
  if (code === 'DOCUMENT_NOT_FOUND') return fail(res, 'NOT_FOUND', 'Document not found', 404);
  const mapped = byCode[code ?? ''];
  const importMessages: Record<string, string> = {
    IMPORT_RESERVATION_REFERENCE_REVIEW_REQUIRED:
      'The existing reservation reference was not found for this customer, or has no compatible application. Review the exact reservation reference; no replacement application was created.',
    IMPORT_TARGET_CHANGED:
      'The customer, genealogy or payment record changed after review. Reload and review the current details before retrying.',
    IMPORT_SOURCE_CHANGED:
      'The import source changed after review. Reload its preview before retrying.',
    IMPORT_SOURCE_IDENTITY_CONFLICT:
      'This purchase reference is already linked to different source details. Review the existing purchase; no duplicate was created.',
    IMPORT_CUSTOMER_FIELD_CONFLICT:
      'Imported customer details conflict with the current record. Review the highlighted fields; current values were preserved.',
    IMPORT_PURCHASE_REFERENCE_REQUIRED:
      'Enter the actual purchase reference. Reuse the same reference for the same purchase.',
    IMPORT_HISTORICAL_TERMS_REVIEW_REQUIRED:
      'The workbook price, reservation fee, plan or payment terms disagree with the current approved offer. Historical terms need authorized review; no terms were replaced.',
    IMPORT_STAFF_REVIEW_REQUIRED:
      'The registered sales identity or genealogy changed or conflicts with the workbook. Review the actual staff placement.',
    IMPORT_APPLICATION_ALREADY_LINKED:
      'This purchase already has an application. Reload and continue the existing application.',
    IMPORT_GENEALOGY_CONFLICT:
      'Referrer and VIP Recommender belong to different VD genealogy trees. Correct the attribution before importing.',
    IMPORT_PAYMENT_RECONCILIATION_REQUIRED:
      'A payment with matching receipt details already exists. Link that payment, or explain why this is a distinct payment.',
    IMPORT_PAYMENT_MATCH_CONFLICT:
      'The selected payment belongs to different purchase details or has a conflicting amount or method. No payment was linked.',
    IMPORT_PROOF_REQUIRED: 'Upload and review a valid private receipt before accepting this claim.',
    IMPORT_PROOF_CHANGED: 'The receipt upload changed. Reload and review the current receipt.',
    OVERPAYMENT_NOT_ALLOWED:
      'This payment would exceed the remaining balance (verified plus pending payments). Overpayments are not accepted.',
    RECEIPT_STORAGE_PATH_REQUIRED: 'Upload the payment receipt before recording the payment.',
    PAYMENT_REFERENCE_REVIEW_REQUIRED:
      'This bank reference or OR number already appears on another contract. Review the match and record why this allocation is correct before verifying.',
    DUPLICATE_OR_NUMBER: 'This Official Receipt number is already used on this contract.',
    CLOSED_PERIOD_IMMUTABLE:
      'This accounting period is closed. Post a correction in an open period instead.',
    PERIOD_NOT_ENDED: 'A month can be closed only after it has ended.',
    PERIOD_OUT_OF_ORDER: 'Close the earlier open months first.',
    PERIOD_SELF_APPROVAL: 'A period cannot be closed by the person who submitted it.',
    PERIOD_NOT_READY: 'This period has not been submitted for closing.',
    PERIOD_NOT_OPEN: 'This period is not open.',
    DRI_NOT_AUTHORIZED: 'DRI commissions are not authorized. Only DSC commissions can be created.',
    COMMISSION_TYPE_IMMUTABLE: 'A commission type cannot be changed once it is recorded.',
    COMMISSION_WITHHELD: 'This commission is on hold. Release the hold before paying it.',
    COMMISSION_NOT_FOUND: 'Commission not found.',
    COMMISSION_NOT_HOLDABLE: 'Only a commission that has not been paid can be put on hold.',
    COMMISSION_NOT_PAYABLE: 'This commission is not ready to be paid.',
    COMMISSION_NOT_PAID: 'Only a paid commission can have a recovery proposed.',
    COMMISSION_HOLD_REASON_REQUIRED: 'Give a reason for the hold.',
    COMMISSION_PAYOUT_FAILURE_REASON_REQUIRED: 'Give a reason the payout failed.',
    COMMISSION_PAYOUT_HISTORY_IMMUTABLE: 'Payout history cannot be edited or deleted.',
    COMMISSION_PAYOUT_NOT_FOUND: 'Payout not found.',
    COMMISSION_PAYOUT_NOT_PAID: 'Only a paid payout can be marked failed or reconciled.',
    DUPLICATE_PAYOUT_REFERENCE: 'This bank reference is already used on another payout.',
    PAYOUT_REFERENCE_REQUIRED: 'Enter the bank reference for the payout.',
    PAYOUT_REFERENCE_MISMATCH:
      'This bank reference does not match the one recorded on the payout. Check the bank statement.',
    COMMISSION_RECOVERY_ALREADY_PROPOSED: 'A recovery is already proposed for this commission.',
    COMMISSION_RECOVERY_EXCEEDS_COMMISSION:
      'The recovery amount cannot be more than the commission.',
    COMMISSION_RECOVERY_HISTORY_IMMUTABLE: 'Recovery history cannot be edited or deleted.',
    COMMISSION_RECOVERY_NOT_FOUND: 'Recovery case not found.',
    COMMISSION_RECOVERY_REASON_REQUIRED: 'Give a reason for the recovery proposal.',
    COMMISSION_RECOVERY_TRIGGER_INVALID: 'Choose a valid reason type for the recovery.',
    IST_PAYROLL_NOT_AUTHORIZED:
      'Live IST payroll is not authorized yet: the governing compensation model is awaiting Presidential approval. Only labelled simulations can be prepared.',
    PAYROLL_SIMULATION_ONLY:
      'This line belongs to a simulation. Record a simulated payout instead.',
    PAYROLL_SIMULATION_BASIS_REQUIRED:
      'Describe the source of the simulation figures (at least 10 characters).',
    PAYROLL_MODE_INVALID: 'Payroll mode must be live or simulation.',
    GOVERNING_POLICY_LOCKED:
      'The governing policy decision cannot be changed from the application.',
    PAYROLL_CONFIGURATION_REQUIRED:
      'Some lines are blocked or no longer match an approved compensation policy. Configure the policy and regenerate the draft before submitting or approving.',
    FINANCIAL_EVIDENCE_BUSY:
      'Payments are being recorded right now, so this payroll or month-end step could not start. Nothing was changed. Try again in a moment.',
    PAYROLL_EVIDENCE_CHANGED:
      'Payroll evidence has changed or is missing. Regenerate the draft and review the current evidence before submitting or approving.',
    PAYROLL_PROOF_REQUIRED: 'Enter the supporting payment or reconciliation evidence reference, at least 10 characters.',
    PAYROLL_PROOF_CONFLICT: 'This external payment already carries a different proof reference.',
    PAYROLL_RECONCILIATION_ALREADY_RECORDED: 'This external payment already has a recorded reconciliation review.',
    PAYROLL_RECONCILIATION_REQUIRED: 'Review the changed evidence on the recorded external payment before closing this payroll batch.',
    PAYROLL_BATCH_NOT_FOUND: 'Payroll batch not found.',
    PAYROLL_BATCH_NOT_EDITABLE: 'Only a draft or returned payroll batch can be changed.',
    PAYROLL_BATCH_EMPTY: 'This payroll batch has no lines.',
    PAYROLL_BATCH_NOT_SUBMITTED: 'This payroll batch is not waiting for approval.',
    PAYROLL_SELF_APPROVAL: 'A payroll batch cannot be approved by the person who submitted it.',
    PAYROLL_RETURN_REASON_REQUIRED:
      'Give a reason of at least 5 characters for returning the batch.',
    PAYROLL_BATCH_LOCKED: 'An approved payroll batch can no longer be changed.',
    PAYROLL_BATCH_TRANSITION_INVALID: 'That change is not allowed for this payroll batch status.',
    PAYROLL_DIRECT_WRITE_REFUSED:
      'Payroll records can only be changed through the payroll workflow.',
    PAYROLL_LINE_INVALID: 'A payroll line has invalid or inconsistent figures.',
    PAYROLL_LINE_DUPLICATE: 'A staff member appears more than once in this payroll batch.',
    PAYROLL_LINE_IMMUTABLE: 'A payroll line cannot be edited; regenerate the draft instead.',
    PAYROLL_LINE_NOT_FOUND: 'Payroll line not found.',
    PAYROLL_LINE_NOT_PAYABLE: 'This payroll line has nothing payable.',
    PAYROLL_BATCH_NOT_APPROVED: 'Payroll can be recorded as paid only after the batch is approved.',
    PAYROLL_AMOUNT_MISMATCH: 'The amount must equal the approved net pay of the line.',
    PAYROLL_METHOD_REQUIRED: 'Enter the payment method.',
    PAYROLL_LINE_ALREADY_DISBURSED: 'This payroll line was already recorded as paid.',
    PAYROLL_DISBURSEMENT_IMMUTABLE: 'A recorded payroll payment cannot be edited or deleted.',
    PAYROLL_SELF_CLOSE: 'The person who submitted this batch cannot close it.',
    PAYROLL_BATCH_NOT_FULLY_DISBURSED: 'Record every payout before closing this batch.',
    PAYROLL_NOT_SIMULATION: 'This payroll line belongs to a live batch, not a simulation.',
    PERIOD_HAS_BLOCKERS:
      'Resolve the blockers listed in Readiness before submitting this period.',
    PAYMENT_ADJUSTMENT_AUTHORITY_PENDING:
      'Who may approve, reject or withdraw payment adjustments is awaiting formal approval (Q13). Nothing was changed; the proposal stays on file.',
    PAYMENT_ADJUSTMENT_NOT_FOUND: 'Payment adjustment not found.',
    PAYMENT_ADJUSTMENT_DECISION_INVALID: 'Choose approve, reject or withdraw.',
    PAYMENT_ADJUSTMENT_NOTE_REQUIRED:
      'Give a note of at least 5 characters explaining the decision.',
    PAYMENT_ADJUSTMENT_ALREADY_RESOLVED: 'This adjustment has already been resolved.',
    PAYMENT_ADJUSTMENT_SELF_DECISION:
      'The person who proposed an adjustment cannot approve or reject it.',
    PAYMENT_ADJUSTMENT_DIRECT_WRITE_REFUSED:
      'Adjustments can only be resolved through the resolution workflow.',
    COMPENSATION_POLICY_NOT_FOUND: 'Compensation policy not found.',
    COMPENSATION_POLICY_INVALID: 'The compensation policy has an invalid value.',
    COMPENSATION_POLICY_NOT_EDITABLE: 'Only a draft policy can be edited.',
    COMPENSATION_POLICY_NOT_PENDING: 'This policy is not waiting for approval.',
    COMPENSATION_POLICY_NOT_APPROVED: 'Only an approved policy can be ended.',
    COMPENSATION_POLICY_TRANSITION_INVALID: 'That change is not allowed for this policy status.',
    COMPENSATION_POLICY_IN_USE_BY_FINALIZED_PAYROLL:
      'This policy already paid an approved or closed payroll month, so its end date cannot cut that month.',
    COMPENSATION_POLICY_SELF_APPROVAL:
      'The person who drafted, edited or submitted a policy cannot approve it.',
    COMPENSATION_POLICY_EVIDENCE_REQUIRED:
      'Enter the reference of the approval document (10 to 500 characters).',
    COMPENSATION_POLICY_APPROVAL_NOTE_REQUIRED:
      'Give an approval note of at least 5 characters.',
    COMPENSATION_POLICY_RETURN_REASON_REQUIRED:
      'Give a reason of at least 5 characters for returning the policy.',
    COMPENSATION_POLICY_END_NOTE_REQUIRED: 'Give a note of at least 5 characters for ending the policy.',
    COMPENSATION_POLICY_END_DATE_INVALID:
      'The end date must be a real date on or after the policy start date.',
    COMPENSATION_POLICY_DIRECT_WRITE_REFUSED:
      'Compensation policies can only be changed through the policy workflow.',
    POLICY_TRANSITION_RULE_NOT_APPROVED:
      'This month spans two compensation policies and the rule for splitting it is not yet approved. Nothing was computed.',
    COMPENSATION_POLICY_IDEMPOTENCY_CONFLICT:
      'This request identifier was already used with different policy data.',
    POLICY_SEGMENT_PAYOUT_NOT_IMPLEMENTED:
      'This month spans two compensation policies and paying a split month is not built yet. Nothing was computed.',
    ...IST_GOVERNED_MESSAGES,
    IST_GOVERNED_KIND_INVALID: 'That kind of record is not supported.',
    IST_GOVERNED_ACTION_INVALID: 'That action is not supported.',
    STAFF_REQUIRED: 'Choose a staff member.',
    PAYROLL_LINE_REVIEW_REQUIRED:
      'A payroll line above a review limit needs a Finance review note before this batch can move on.',
    PAYROLL_LINE_REVIEW_NOT_REQUIRED: 'This payroll line is not flagged for review.',
    PAYROLL_LINE_ALREADY_REVIEWED: 'This payroll line was already reviewed.',
    PAYROLL_REVIEW_NOTE_REQUIRED: 'Give a review note of at least 5 characters.',
    PAYMENT_DATE_INVALID: 'The payment date must be a real date that is not in the future.',
    VERIFIED_PAYMENT_DETAILS_IMMUTABLE:
      'Verified receipt history is locked. Record a separate adjustment proposal for review.',
    FINANCIAL_HISTORY_PROTECTED:
      'Financial history cannot be deleted or replaced. Record a separate adjustment proposal for review.',
    CUSTOMER_FINANCIAL_HISTORY_PROTECTED:
      'This customer has financial history or retained documents. Permanent deletion requires an approved retention decision.',
    SALE_FINANCIAL_DETAILS_IMMUTABLE:
      'The sale preserves its original commercial terms and seller attribution.',
    COMMISSION_FINANCIAL_DETAILS_IMMUTABLE:
      'The commission preserves its original amount, rate, source and beneficiary.',
    PAYMENT_NOT_PENDING: 'Only a payment that is still pending verification can be changed.',
    PAYMENT_NOT_VERIFIED: 'Only a verified payment can be reversed, returned or refunded.',
    PAYMENT_ADJUSTMENT_EXCEEDS_PAYMENT: 'The adjustment cannot be more than the payment.',
    PAYMENT_ADJUSTMENT_ALREADY_PROPOSED: 'This payment already has an open proposal of that kind.',
    PAYMENT_ADJUSTMENT_APPROVAL_NOT_AUTHORIZED:
      'Approving payment adjustments is not enabled yet. The proposal stays on file for review.',
    RECEIPT_STORAGE_OBJECT_NOT_FOUND:
      'The uploaded receipt could not be found. Upload the receipt again, then record the payment.',
    RECEIPT_ALREADY_USED:
      'This receipt was already used for another payment. Upload the receipt for this payment.',
    SELLER_OF_RECORD_MUST_BE_SM: 'The seller of record must be an active Sales Manager.',
    IMPORT_DUPLICATE_VIP_CARD_NUMBER: 'VIP Card number already exists in the system.',
    SIGNED_APPLICATION_DOCUMENT_REQUIRED:
      'An accepted signed Customer Application is required before approval.',
    SIGNED_RA_DOCUMENT_REQUIRED:
      'An accepted signed Reservation Agreement is required before approval.',
    APPLICATION_APPROVAL_FORBIDDEN: 'Only Admin or Super Admin may approve or reject an application and RA.',
    APPLICATION_APPROVAL_REQUIRED: 'Approve the application and RA together from the application.',
    APPLICATION_SUBMISSION_REQUIRED: 'Submit the application and RA before uploading signed documents.',
    LINKED_RESERVATION_REQUIRED: 'The linked Reservation Agreement is required.',
    PURCHASE_HAS_PAYMENTS: 'This purchase has payment history and cannot be cancelled through application review.',
    PURCHASE_WORKFLOW_REQUIRED: 'Use the approved Application & RA purchase workflow.',
    RESERVATION_PAYMENT_REQUIRED: 'Verify the reservation payment required by these purchase terms first.',
    RESERVATION_FEE_MUST_MATCH_TERMS: 'Enter the exact reservation fee required by these purchase terms.',
    CURRENT_ID_DOCUMENT_REQUIRED: 'A current, reviewed identity document is required before submission.',
    ACTIVATION_AGREEMENT_NOT_FINALIZED:
      'The Reservation Agreement must be finalized before this membership can be activated.',
    VIP_CARD_ID_REQUIRED:
      'A VIP Card ID has not been issued yet; it is issued at the first verified qualifying payment.',
  };
  console.error('[api] rpc error:', message);
  if (mapped)
    return fail(
      res,
      mapped[0],
      code === 'SALE_COMPLETE_HIERARCHY_REQUIRED'
        ? 'Complete the seller hierarchy before creating this sale.'
        : (code === 'COMPENSATION_POLICY_INVALID' || IST_INVALID_CODES.has(code ?? '')) &&
            error?.details
          ? `${
              code?.startsWith('IST_ENGAGEMENT')
                ? 'The IST engagement'
                : code?.startsWith('IST_PERFORMANCE_RULE')
                  ? 'The performance rule'
                  : 'The compensation policy'
            } is invalid: ${error.details}.`
          : (importMessages[code ?? ''] ?? code!.replace(/_/g, ' ').toLowerCase()),
      mapped[1],
    );

  // Postgres unique violation (23505) surfaces as a duplicate conflict rather
  // than an opaque 500.
  if (
    error &&
    'code' in (error as Record<string, unknown>) &&
    (error as { code?: string }).code === '23505'
  ) {
    return fail(res, 'CONFLICT', 'A record with these details already exists', 409);
  }
  return fail(res, 'INTERNAL', 'Internal server error', 500);
}

/** Read a JSON body, tolerating Vercel's string-encoded form. */
export function jsonBody(req: VercelRequest): unknown {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return undefined;
    }
  }
  return req.body;
}

/** ISO timestamp or null, for nullable timestamptz columns. */
export function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function requireString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Extract the single row of a `RETURNS TABLE` RPC result.
 *
 * Live PostgREST returns a set-returning function as an ARRAY of rows
 * (`[{ sale_number: 'SALE-000001' }]`), never a bare object. A bare object
 * is tolerated only so older scripted doubles keep working; anything else -
 * an empty array, more than one row, a scalar, null - yields null so the
 * caller fails closed BEFORE persisting anything.
 */
export function singleRpcRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : undefined) : data;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  return row as Record<string, unknown>;
}

/**
 * Extract a single non-blank text column from a `RETURNS TABLE` RPC result.
 * Returns null when the shape is wrong, the column is missing, or the value
 * is blank - every one of those is a generation failure, never an empty
 * string to persist.
 */
export function singleRpcText(data: unknown, column: string): string | null {
  const row = singleRpcRow(data);
  if (!row) return null;
  const value = row[column];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
