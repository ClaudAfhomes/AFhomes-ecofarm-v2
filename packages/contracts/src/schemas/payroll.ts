import { z } from 'zod';

import { exactDecimalStringSchema } from './money.js';

/**
 * IST payroll (migrations 20270105000005/6). Money is exact-decimal text. Live
 * payroll is gated by the owner's Q1 decision (Pending Presidential Approval);
 * simulations carry explicitly supplied historical reference figures, are
 * labelled, and may rehearse submit → approve → simulated payout → close in
 * isolated records that never touch real finance totals.
 */
export const payrollPeriodSchema = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
const reason = z.string().trim().min(5).max(500);
const money = exactDecimalStringSchema;

const realDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Enter a real calendar date.');

export const payrollRankSchema = z.enum(['SM', 'SSM', 'SVD']);
export type PayrollRank = z.infer<typeof payrollRankSchema>;

export const payrollBatchStatusSchema = z.enum([
  'draft',
  'submitted',
  'approved',
  'returned',
  'closed',
]);
export const payrollModeSchema = z.enum(['live', 'simulation']);

/** Read-only gate status. `liveAuthorized` is true only once Q1 is approved. */
export const payrollGateSchema = z.object({
  q1Status: z.enum(['pending', 'approved']),
  liveAuthorized: z.boolean(),
  note: z.string().nullable(),
  /**
   * How Q1 reached the system. `owner_reported` + `awaiting_evidence` means the owner told
   * the system the President chose Option C; no approval document, signature or effective
   * date is on file. Never present it as a signed approval.
   */
  q1Source: z.enum(['owner_reported', 'approval_document']).nullable(),
  q1DecisionOption: z.string().nullable(),
  q1EvidenceStatus: z.enum(['awaiting_evidence', 'evidence_on_file']).nullable(),
  /** Null when the approval stated no effective date (never invented). */
  q1EffectiveDate: z.string().nullable(),
});
export type PayrollGate = z.infer<typeof payrollGateSchema>;

/** Read-only staff picker row (SM/SSM/SVD only; OST is never listed). */
export const payrollRosterEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  aaNumber: z.string().nullable(),
  rank: payrollRankSchema,
  roleName: z.string(),
  status: z.string(),
  eligible: z.boolean(),
  ineligibleReason: z.string().optional(),
});
export type PayrollRosterEntry = z.infer<typeof payrollRosterEntrySchema>;

/** Read-only view of an `ist_compensation_policies` row. Nothing here creates or approves one. */
export const payrollPolicySchema = z.object({
  id: z.string().uuid(),
  rank: payrollRankSchema,
  monthlyBa: money,
  baTarget: money,
  monthlyPa: money,
  paTarget: money,
  pbTarget: money,
  pbRate: z.string(),
  collectionGate: z.string(),
  effectiveFrom: z.string(),
  effectiveUntil: z.string().nullable(),
  status: z.enum(['draft', 'pending_approval', 'approved', 'retired']),
  lifecycle: z
    .enum(['draft', 'pending_approval', 'approved', 'active', 'superseded', 'expired', 'retired'])
    .optional(),
  lastFinalizedPeriod: z.string().nullable().optional(),
  policyVersion: z.number().int().positive().optional(),
  basisNote: z.string(),
  qpEpRuleReference: z.string().nullable().optional(),
  kpiCollectionPolicyReference: z.string().nullable().optional(),
  limitExceptionRule: z.string().nullable().optional(),
  baReviewLimit: money.nullable().optional(),
  paReviewLimit: money.nullable().optional(),
  pbReviewLimit: money.nullable().optional(),
  netReviewLimit: money.nullable().optional(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().nullable(),
  /** UX hint only; SQL independently rejects every prior preparer on approval. */
  approvalConflict: z.boolean().optional(),
});
export type PayrollPolicy = z.infer<typeof payrollPolicySchema>;

export const payrollPoliciesResponseSchema = z.object({
  data: z.array(payrollPolicySchema),
  meta: z.object({ total: z.number().int().nonnegative() }),
  states: z.array(z.lazy(() => policyStateSchema)).optional(),
  gate: payrollGateSchema,
});
export type PayrollPoliciesResponse = z.infer<typeof payrollPoliciesResponseSchema>;

export const payrollBatchSchema = z.object({
  id: z.string().uuid(),
  period: payrollPeriodSchema,
  mode: payrollModeSchema,
  simulationBasis: z.string().nullable(),
  /** Simulation figure only; never part of a payable total. */
  simulationTotalNet: money.nullable(),
  status: payrollBatchStatusSchema,
  totalBa: money,
  totalPa: money,
  totalPb: money,
  totalAdjustments: money,
  totalWithheld: money,
  totalNet: money,
  lineCount: z.number().int().nonnegative(),
  computedLineCount: z.number().int().nonnegative(),
  blockedLineCount: z.number().int().nonnegative(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  submittedBy: z.string().uuid().nullable(),
  submittedAt: z.string().nullable(),
  decidedBy: z.string().uuid().nullable(),
  decidedAt: z.string().nullable(),
  returnReason: z.string().nullable(),
  closedBy: z.string().uuid().nullable(),
  closedAt: z.string().nullable(),
});
export type PayrollBatch = z.infer<typeof payrollBatchSchema>;

export const payrollDisbursementSchema = z.object({
  id: z.string().uuid(),
  lineId: z.string().uuid(),
  amount: money,
  method: z.string(),
  bankReference: z.string(),
  paidOn: z.string(),
  recordedBy: z.string().uuid(),
  recordedAt: z.string(),
  proofReference: z.string().nullable().optional(),
  evidenceChanged: z.boolean().optional(),
  reconciled: z.boolean().optional(),
  reconciliationNote: z.string().nullable().optional(),
  /** True for a rehearsal record from a simulation batch; never money. */
  simulation: z.boolean().optional(),
});
export type PayrollDisbursement = z.infer<typeof payrollDisbursementSchema>;

export const reconcilePayrollDisbursementSchema = z
  .object({
    note: z.string().trim().min(5).max(2000),
    evidenceReference: z.string().trim().min(10).max(500),
  })
  .strict();

export const payrollLineSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  staffId: z.string().uuid(),
  staffName: z.string().nullable(),
  rank: payrollRankSchema,
  status: z.enum(['computed', 'blocked']),
  /** Set only on a blocked line; money fields are then all null. */
  blockedReason: z.string().nullable(),
  policyId: z.string().uuid().nullable(),
  ba: money.nullable(),
  pa: money.nullable(),
  pb: money.nullable(),
  adjustments: money.nullable(),
  withheld: money.nullable(),
  net: money.nullable(),
  /** A computed figure above a configured review limit needs a Finance note before submit. */
  reviewRequired: z.boolean(),
  reviewFlags: z.array(z.string()),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  /** Display name of the reviewer; absent on older payloads. */
  reviewedByName: z.string().nullable().optional(),
  disbursement: payrollDisbursementSchema.nullable(),
});
export type PayrollLine = z.infer<typeof payrollLineSchema>;

export const payrollBatchDetailSchema = payrollBatchSchema.extend({
  lines: z.array(payrollLineSchema),
});
export type PayrollBatchDetail = z.infer<typeof payrollBatchDetailSchema>;

export const pendingPayrollApprovalSchema = z.object({
  batchId: z.string().uuid(),
  period: payrollPeriodSchema,
  lineCount: z.number().int().nonnegative(),
  computedLineCount: z.number().int().nonnegative(),
  totalNet: money,
  submittedBy: z.string().uuid().nullable(),
  submittedAt: z.string().nullable(),
  /** 'simulation' rows are labelled rehearsals; their totalNet is a simulation figure. */
  mode: payrollModeSchema,
  simulationBasis: z.string().nullable(),
});
export type PendingPayrollApproval = z.infer<typeof pendingPayrollApprovalSchema>;

/* ---- Requests ---- */

export const generatePayrollDraftSchema = z.object({ period: payrollPeriodSchema });
export type GeneratePayrollDraftRequest = z.infer<typeof generatePayrollDraftSchema>;

export const returnPayrollBatchSchema = z.object({ reason });
export type ReturnPayrollBatchRequest = z.infer<typeof returnPayrollBatchSchema>;

export const payrollDisbursementRequestSchema = z.object({
  amount: money.refine((v) => /[1-9]/.test(v), { message: 'amount must be greater than zero' }),
  method: z.string().trim().min(1).max(40),
  bankReference: z.string().trim().min(3).max(100),
  paidOn: realDate,
  proofReference: z.string().trim().min(10).max(500).optional(),
});
export type PayrollDisbursementRequest = z.infer<typeof payrollDisbursementRequestSchema>;

/** Result of submit / approve / return / close, labelled with the batch mode. */
export const payrollBatchActionResultSchema = z.object({
  id: z.string().uuid(),
  status: payrollBatchStatusSchema,
  mode: payrollModeSchema,
});
export type PayrollBatchActionResult = z.infer<typeof payrollBatchActionResultSchema>;

/** Decimal fraction text, e.g. '0.01'. */
const fractionString = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/);
const unitFraction = fractionString.refine((v) => Number(v) <= 1, 'must not exceed 1');

/** A historical REFERENCE policy supplied for a simulation only. Never stored as a policy. */
export const simulationPolicySnapshotSchema = z.object({
  version: z.string().trim().min(1).max(80),
  monthlyBa: money,
  baTarget: money,
  monthlyPa: money,
  paTarget: money,
  pbTarget: money,
  pbRate: unitFraction,
  collectionGate: unitFraction.refine((v) => Number(v) > 0, 'must be greater than 0'),
});
export type SimulationPolicySnapshot = z.infer<typeof simulationPolicySnapshotSchema>;

const stretchSchema = z.object({ kpi: money, collection: money });

/** Explicitly supplied performance inputs for one IST in a simulation. */
export const simulationLineInputSchema = z.object({
  staffId: z.string().uuid(),
  contractStart: realDate,
  contractEnd: realDate.nullable().optional(),
  suspendedFrom: realDate.nullable().optional(),
  qp: stretchSchema,
  ep: stretchSchema,
  qpBaApproved: z.boolean().nullable(),
  baWithheld: z.boolean().optional(),
  authorizedAdjustments: money.optional(),
});
export type SimulationLineInput = z.infer<typeof simulationLineInputSchema>;

export const simulatePayrollSchema = z.object({
  period: payrollPeriodSchema,
  simulationBasis: z.string().trim().min(10).max(500),
  policySnapshot: z
    .object({
      SM: simulationPolicySnapshotSchema.optional(),
      SSM: simulationPolicySnapshotSchema.optional(),
      SVD: simulationPolicySnapshotSchema.optional(),
    })
    .refine((v) => Object.values(v).some(Boolean), 'Supply at least one rank policy snapshot.'),
  lines: z.array(simulationLineInputSchema).max(500).default([]),
});
export type SimulatePayrollRequest = z.infer<typeof simulatePayrollSchema>;

/* ---- Compensation policy lifecycle (migration 20270105000008) ---- */

export const policyLifecycleSchema = z.enum([
  'draft',
  'pending_approval',
  'approved',
  'active',
  'superseded',
  'expired',
  'retired',
]);
export type PolicyLifecycle = z.infer<typeof policyLifecycleSchema>;

/** Derived state of one policy (active/superseded/expired are never stored). */
export const policyStateSchema = z.object({
  policyId: z.string().uuid(),
  rank: payrollRankSchema,
  policyVersion: z.number().int().positive(),
  status: z.string(),
  lifecycle: policyLifecycleSchema,
  /** Latest period of an approved/closed LIVE batch that paid with this policy, if any. */
  lastFinalizedPeriod: payrollPeriodSchema.nullable(),
});
export type PolicyState = z.infer<typeof policyStateSchema>;

const optionalText = z.string().trim().min(1).max(500).nullable().optional();
const policyMoney = z.string().regex(/^(0|[1-9][0-9]{0,14})(\.[0-9]{1,2})?$/);
const optionalLimit = policyMoney.nullable().optional();
const rate = z.string().regex(/^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$/, 'Enter a rate from 0 to 1.');

/** Full document of a policy draft. An update replaces every field. */
export const policyDraftInputSchema = z
  .object({
    rank: payrollRankSchema,
    monthlyBa: policyMoney,
    baTarget: policyMoney,
    monthlyPa: policyMoney,
    paTarget: policyMoney,
    pbTarget: policyMoney,
    pbRate: rate,
    collectionGate: rate.refine(
      (v) => /[1-9]/.test(v),
      'Collection gate must be greater than zero.',
    ),
    effectiveFrom: realDate,
    effectiveUntil: realDate.nullable().optional(),
    basisNote: z.string().trim().min(5).max(2000),
    qpEpRuleReference: optionalText,
    kpiCollectionPolicyReference: optionalText,
    limitExceptionRule: optionalText,
    baReviewLimit: optionalLimit,
    paReviewLimit: optionalLimit,
    pbReviewLimit: optionalLimit,
    netReviewLimit: optionalLimit,
  })
  .strict()
  .refine((value) => !value.effectiveUntil || value.effectiveUntil >= value.effectiveFrom, {
    path: ['effectiveUntil'],
    message: 'End date must be on or after the start date.',
  });
export type PolicyDraftInput = z.infer<typeof policyDraftInputSchema>;

export const approvePolicyInputSchema = z
  .object({
    evidenceReference: z.string().trim().min(10).max(500),
    note: z.string().trim().min(5).max(2000),
  })
  .strict();
export type ApprovePolicyInput = z.infer<typeof approvePolicyInputSchema>;

export const returnPolicyInputSchema = z.object({ reason }).strict();
export type ReturnPolicyInput = z.infer<typeof returnPolicyInputSchema>;

export const endPolicyInputSchema = z
  .object({ effectiveUntil: realDate, note: z.string().trim().min(5).max(2000) })
  .strict();
export type EndPolicyInput = z.infer<typeof endPolicyInputSchema>;

export const reviewPayrollLineInputSchema = z
  .object({ note: z.string().trim().min(5).max(2000) })
  .strict();
export type ReviewPayrollLineInput = z.infer<typeof reviewPayrollLineInputSchema>;

export const policyActionResultSchema = z.object({
  policyId: z.string().uuid(),
  status: z.string(),
});
export type PolicyActionResult = z.infer<typeof policyActionResultSchema>;

export const policySegmentSchema = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number().int().positive(),
  policyId: z.string().uuid().nullable(),
  policyVersion: z.number().int().positive().nullable(),
});

export const payrollPolicySegmentsSchema = z.object({
  period: payrollPeriodSchema,
  /** True only when governing key COMPENSATION_POLICY_TRANSITION_RULE is approved. */
  transitionRuleApproved: z.boolean(),
  ranks: z.array(
    z.object({
      rank: payrollRankSchema,
      period: payrollPeriodSchema,
      monthStart: z.string(),
      monthEnd: z.string(),
      singlePolicy: z.boolean(),
      transition: z.boolean(),
      segments: z.array(policySegmentSchema),
    }),
  ),
});
export type PayrollPolicySegments = z.infer<typeof payrollPolicySegmentsSchema>;

export const payrollLineReviewResultSchema = z.object({
  lineId: z.string().uuid(),
  status: z.literal('reviewed'),
});
export type PayrollLineReviewResult = z.infer<typeof payrollLineReviewResultSchema>;

/** Review flags the line guard may set (BA/PA above policy added by migration 20270105000008). */
export const payrollReviewFlagSchema = z.enum([
  'BA_ABOVE_REVIEW_LIMIT',
  'PA_ABOVE_REVIEW_LIMIT',
  'PB_ABOVE_REVIEW_LIMIT',
  'NET_ABOVE_REVIEW_LIMIT',
  'BA_ABOVE_POLICY_AMOUNT',
  'PA_ABOVE_POLICY_AMOUNT',
]);
export type PayrollReviewFlag = z.infer<typeof payrollReviewFlagSchema>;

/* ---- IST engagements and performance rules (migration 20270105000009) ---- */

const governedStatusSchema = z.enum(['draft', 'pending_approval', 'approved']);
const longNote = z.string().trim().min(5).max(2000);
const sourceText = z.string().trim().min(10).max(500);

/** Draft or edit of an IST engagement. The actor is the session, never a field. */
export const engagementDraftInputSchema = z
  .object({
    staffId: z.string().uuid(),
    rank: payrollRankSchema,
    contractStart: realDate,
    contractEnd: realDate.nullable().optional(),
    evidenceReference: sourceText,
    qpBaApproved: z.boolean().nullable().optional(),
    qpDecisionReference: sourceText.nullable().optional(),
  })
  .strict()
  .refine((v) => v.qpBaApproved == null || v.qpDecisionReference != null, {
    message: 'A QP decision needs its authorization reference',
    path: ['qpDecisionReference'],
  });
export type EngagementDraftInput = z.infer<typeof engagementDraftInputSchema>;

/** Sets an approved engagement's end and/or suspension date (each once). At least one is required. */
export const engagementEndInputSchema = z
  .object({
    contractEnd: realDate.nullable().optional(),
    suspendedFrom: realDate.nullable().optional(),
    note: longNote,
  })
  .strict()
  .refine((v) => Boolean(v.contractEnd || v.suspendedFrom), {
    message: 'Give a contract end date, a suspension date, or both.',
  });
export type EngagementEndInput = z.infer<typeof engagementEndInputSchema>;

const percentText = z.string().regex(/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,2})?$/);

/**
 * Draft or edit of a performance rule. An absent / null rule column means "that rule is not
 * approved yet" and keeps every figure blocked. Nothing here is a default.
 */
export const performanceRuleDraftInputSchema = z
  .object({
    effectiveFrom: realDate,
    effectiveUntil: realDate.nullable().optional(),
    attributionBasis: z.enum(['seller_only', 'team_genealogy']).nullable().optional(),
    closedDealThresholdPct: percentText
      .refine((v) => Number(v) > 0 && Number(v) <= 100, 'must be above 0 and at most 100')
      .nullable()
      .optional(),
    countDateBasis: z.enum(['verified_posting_period', 'paid_on']).nullable().optional(),
    assumedCreditRate: z
      .string()
      .regex(/^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$/)
      .nullable()
      .optional(),
    adjustmentTreatment: z.literal('report_only').nullable().optional(),
    sourceReference: sourceText,
  })
  .strict();
export type PerformanceRuleDraftInput = z.infer<typeof performanceRuleDraftInputSchema>;

export const performanceRuleEndInputSchema = z
  .object({ effectiveUntil: realDate, note: longNote })
  .strict();
export type PerformanceRuleEndInput = z.infer<typeof performanceRuleEndInputSchema>;

export const governedActionResultSchema = z.object({ id: z.string().uuid(), status: z.string() });
export type GovernedActionResult = z.infer<typeof governedActionResultSchema>;

const actorFields = {
  createdBy: z.string().uuid(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  submittedBy: z.string().uuid().nullable(),
  submittedAt: z.string().nullable(),
  returnedBy: z.string().uuid().nullable(),
  returnedAt: z.string().nullable(),
  returnReason: z.string().nullable(),
  approvedBy: z.string().uuid().nullable(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvalEvidenceReference: z.string().nullable(),
  approvalNote: z.string().nullable(),
  endedBy: z.string().uuid().nullable(),
  endedAt: z.string().nullable(),
  endNote: z.string().nullable(),
};

export const istEngagementSchema = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
  staffName: z.string().nullable(),
  rank: payrollRankSchema,
  contractStart: z.string(),
  contractEnd: z.string().nullable(),
  suspendedFrom: z.string().nullable(),
  evidenceReference: z.string(),
  qpBaApproved: z.boolean().nullable().optional(),
  qpDecisionReference: z.string().nullable().optional(),
  status: governedStatusSchema,
  ...actorFields,
});
export type IstEngagement = z.infer<typeof istEngagementSchema>;

export const istPerformanceRuleSchema = z.object({
  id: z.string().uuid(),
  ruleVersion: z.number().int().positive(),
  effectiveFrom: z.string(),
  effectiveUntil: z.string().nullable(),
  attributionBasis: z.enum(['seller_only', 'team_genealogy']).nullable(),
  closedDealThresholdPct: z.string().nullable(),
  countDateBasis: z.enum(['verified_posting_period', 'paid_on']).nullable(),
  assumedCreditRate: z.string().nullable(),
  adjustmentTreatment: z.literal('report_only').nullable(),
  sourceReference: z.string(),
  status: governedStatusSchema,
  ...actorFields,
});
export type IstPerformanceRule = z.infer<typeof istPerformanceRuleSchema>;

/** Per-staff figures for one month. A BLOCKED entry carries zero money and its blocker codes. */
export const istPerformanceStaffSchema = z.object({
  staffId: z.string().uuid(),
  rank: payrollRankSchema,
  contractStart: z.string().nullable(),
  contractEnd: z.string().nullable(),
  suspendedFrom: z.string().nullable(),
  qpBaApproved: z.boolean().nullable().optional(),
  qpDecisionReference: z.string().nullable().optional(),
  kpi: money,
  collection: money,
  verifiedCash: money,
  assumedCredit: money,
  approvedAdjustmentsTotal: money,
  proposedAdjustmentsTotal: money,
  status: z.enum(['CALCULABLE', 'BLOCKED']),
  blockers: z.array(z.string()),
  evidenceHash: z.string(),
  evidenceCount: z.number().int().nonnegative(),
  ruleId: z.string().uuid().nullable(),
  ruleVersion: z.number().int().positive().nullable(),
  engagementId: z.string().uuid().nullable(),
});
export type IstPerformanceStaff = z.infer<typeof istPerformanceStaffSchema>;

export const istPeriodPerformanceSchema = z.object({
  period: payrollPeriodSchema,
  ruleId: z.string().uuid().nullable(),
  ruleVersion: z.number().int().positive().nullable(),
  ruleBlocker: z.string().nullable(),
  /** Staff names for display, keyed by staffId (added by the API; the RPC carries none). */
  staffNames: z.record(z.string(), z.string().nullable()).optional(),
  /** Verified evidence that has no staff seller of record (optional; added by newer migrations). */
  unattributed: z.object({ count: z.number().int().nonnegative(), total: money }).optional(),
  /** Verified evidence whose seller of record is not on the IST roster (optional). */
  offRoster: z.object({ count: z.number().int().nonnegative(), total: money }).optional(),
  staff: z.array(istPerformanceStaffSchema),
});
export type IstPeriodPerformance = z.infer<typeof istPeriodPerformanceSchema>;

/** One verified payment touching the month, with its eligibility and why. */
export const istPerformanceEvidenceItemSchema = z.object({
  staffId: z.string().uuid().nullable(),
  period: payrollPeriodSchema,
  saleId: z.string().uuid().nullable(),
  reservationId: z.string().uuid().nullable(),
  paymentId: z.string().uuid(),
  saleNumber: z.string().nullable().optional(),
  reservationNumber: z.string().nullable().optional(),
  paymentNumber: z.string().nullable().optional(),
  amount: money,
  postingPeriod: z.string().nullable(),
  paidOn: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  paymentPurpose: z.string().nullable(),
  sellerStaffId: z.string().uuid().nullable(),
  contractPriceSnapshot: money.nullable(),
  cumulativeVerifiedAtPeriodEnd: money.nullable(),
  evidenceClass: z.string(),
  eligibility: z.enum(['ELIGIBLE', 'INELIGIBLE', 'UNDETERMINED']),
  reasonCode: z.string().nullable(),
  countPeriod: z.string().nullable(),
  countDate: z.string().nullable(),
  isClosingPayment: z.boolean(),
  closedDealThresholdAmount: money.nullable(),
  approvedAdjustmentsTotal: money,
  proposedAdjustmentsTotal: money,
  assumedCredit: money,
  ruleId: z.string().uuid().nullable(),
  engagementId: z.string().uuid().nullable(),
});
export type IstPerformanceEvidenceItem = z.infer<typeof istPerformanceEvidenceItemSchema>;

export const istStaffPerformanceEvidenceSchema = z.object({
  period: payrollPeriodSchema,
  staffId: z.string().uuid(),
  /** Null when the staff member is not on the active IST roster. */
  summary: istPerformanceStaffSchema.nullable(),
  items: z.array(istPerformanceEvidenceItemSchema),
});
export type IstStaffPerformanceEvidence = z.infer<typeof istStaffPerformanceEvidenceSchema>;

const calculationMoney = money.nullable().optional();
const calculationStretch = z.object({
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  days: z.number().int().nonnegative().optional(),
  baPass: z.boolean().optional(),
  paPass: z.boolean().optional(),
  pbPass: z.boolean().optional(),
  equivalentTcp: calculationMoney,
});
/** Saved calculation evidence only. Never recompute an approved line for display. */
export const payrollLineCalculationSchema = z.object({
  lineId: z.string().uuid(),
  batchId: z.string().uuid(),
  period: payrollPeriodSchema,
  mode: payrollModeSchema,
  inputs: z.object({
    month: z.string().optional(),
    contractStart: z.string().nullable().optional(),
    contractEnd: z.string().nullable().optional(),
    suspendedFrom: z.string().nullable().optional(),
    qualifyingPeriodEnd: z.string().optional(),
    qpBaApproved: z.boolean().nullable().optional(),
    engagementId: z.string().uuid().nullable().optional(),
    ruleId: z.string().uuid().nullable().optional(),
    ruleVersion: z.number().int().positive().nullable().optional(),
    evidenceHash: z.string().nullable().optional(),
    evidenceCount: z.number().int().nonnegative().optional(),
    blockers: z.array(z.string()).optional(),
    qp: z.object({ kpi: money, collection: money }).optional(),
    ep: z.object({ kpi: money, collection: money }).optional(),
    policySnapshot: z
      .object({
        version: z.string().optional(),
        rank: payrollRankSchema.optional(),
        monthlyBa: money,
        baTarget: money,
        monthlyPa: money,
        paTarget: money,
        pbTarget: money,
        pbRate: z.string(),
        collectionGate: z.string(),
      })
      .optional(),
    performanceEvidence: z
      .object({
        summary: istPerformanceStaffSchema,
        items: z.array(istPerformanceEvidenceItemSchema),
      })
      .optional(),
  }),
  result: z.object({
    status: z.enum(['CALCULATED', 'BLOCKED']).optional(),
    exceptions: z.array(z.string()).optional(),
    policyVersion: z.string().nullable().optional(),
    daysInMonth: z.number().int().positive().optional(),
    qp: calculationStretch.optional(),
    ep: calculationStretch.optional(),
    ba: calculationMoney,
    pa: calculationMoney,
    pb: calculationMoney,
    gross: calculationMoney,
    baWithheldAmount: calculationMoney,
    authorizedAdjustments: calculationMoney,
    net: calculationMoney,
  }),
});
export type PayrollLineCalculation = z.infer<typeof payrollLineCalculationSchema>;
