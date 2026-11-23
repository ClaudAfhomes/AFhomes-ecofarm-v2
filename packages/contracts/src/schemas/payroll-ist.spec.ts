import { describe, expect, it } from 'vitest';

import {
  approvePolicyInputSchema,
  engagementDraftInputSchema,
  engagementEndInputSchema,
  istPeriodPerformanceSchema,
  performanceRuleDraftInputSchema,
  performanceRuleEndInputSchema,
} from './payroll.js';

const STAFF = '10101010-0000-4000-8000-000000000003';

describe('IST engagement and performance rule contracts', () => {
  it('accepts a minimal engagement draft and refuses an actor or short evidence', () => {
    const ok = {
      staffId: STAFF,
      rank: 'SM',
      contractStart: '2026-01-01',
      evidenceReference: 'Signed contract 2026-01',
    };
    expect(engagementDraftInputSchema.safeParse(ok).success).toBe(true);
    expect(engagementDraftInputSchema.safeParse({ ...ok, createdBy: STAFF }).success).toBe(false);
    expect(engagementDraftInputSchema.safeParse({ ...ok, evidenceReference: 'short' }).success).toBe(false);
    expect(engagementDraftInputSchema.safeParse({ ...ok, rank: 'OST' }).success).toBe(false);
    expect(engagementDraftInputSchema.safeParse({ ...ok, contractStart: '2026-02-30' }).success).toBe(false);
  });

  it('needs an end or suspension date and a note to end an engagement', () => {
    expect(engagementEndInputSchema.safeParse({ note: 'Contract ended' }).success).toBe(false);
    expect(
      engagementEndInputSchema.safeParse({ contractEnd: '2026-12-31', note: 'Contract ended' }).success,
    ).toBe(true);
    expect(
      engagementEndInputSchema.safeParse({ suspendedFrom: '2026-12-01', note: 'Suspended' }).success,
    ).toBe(true);
  });

  it('treats absent rule choices as undecided and bounds the percentage and rate', () => {
    const base = { effectiveFrom: '2026-01-01', sourceReference: 'Board memo 2026-11' };
    expect(performanceRuleDraftInputSchema.safeParse(base).success).toBe(true);
    expect(performanceRuleDraftInputSchema.safeParse({ ...base, closedDealThresholdPct: '0' }).success).toBe(false);
    expect(performanceRuleDraftInputSchema.safeParse({ ...base, closedDealThresholdPct: '100.5' }).success).toBe(false);
    expect(performanceRuleDraftInputSchema.safeParse({ ...base, closedDealThresholdPct: '40' }).success).toBe(true);
    expect(performanceRuleDraftInputSchema.safeParse({ ...base, assumedCreditRate: '1.5' }).success).toBe(false);
    expect(performanceRuleDraftInputSchema.safeParse({ ...base, countDateBasis: 'other' }).success).toBe(false);
    expect(performanceRuleDraftInputSchema.safeParse({ ...base, adjustmentTreatment: 'net' }).success).toBe(false);
    expect(performanceRuleEndInputSchema.safeParse({ effectiveUntil: '2026-12-31', note: 'Superseded' }).success).toBe(true);
  });

  it('needs a 10 character approval reference', () => {
    expect(approvePolicyInputSchema.safeParse({ evidenceReference: 'DOC-1', note: 'Reviewed ok' }).success).toBe(false);
    expect(
      approvePolicyInputSchema.safeParse({ evidenceReference: 'Board resolution 2026', note: 'Reviewed ok' }).success,
    ).toBe(true);
  });

  it('requires authorization evidence for an explicit QP allowance decision', () => {
    const draft = { staffId: STAFF, rank: 'SM', contractStart: '2026-07-03', evidenceReference: 'TEST ONLY contract reference', qpBaApproved: true };
    expect(engagementDraftInputSchema.safeParse(draft).success).toBe(false);
    expect(engagementDraftInputSchema.safeParse({ ...draft, qpDecisionReference: 'TEST ONLY approved QP qualification rule and attendance review' }).success).toBe(true);
  });

  it('keeps blocker codes open strings and unattributed optional', () => {
    const staff = {
      staffId: STAFF,
      rank: 'SM',
      contractStart: null,
      contractEnd: null,
      suspendedFrom: null,
      kpi: '0.00',
      collection: '0.00',
      verifiedCash: '0.00',
      assumedCredit: '0.00',
      approvedAdjustmentsTotal: '0.00',
      proposedAdjustmentsTotal: '0.00',
      status: 'BLOCKED',
      blockers: ['SOME_FUTURE_CODE', 'CONTRACT_SNAPSHOT_MISMATCH'],
      evidenceHash: 'a'.repeat(64),
      evidenceCount: 0,
      ruleId: null,
      ruleVersion: null,
      engagementId: null,
    };
    const doc = { period: '2026-08', ruleId: null, ruleVersion: null, ruleBlocker: 'NEW_RULE_CODE', staff: [staff] };
    expect(istPeriodPerformanceSchema.safeParse(doc).success).toBe(true);
    expect(
      istPeriodPerformanceSchema.safeParse({ ...doc, unattributed: { count: 2, total: '100.00' } }).success,
    ).toBe(true);
  });
});
