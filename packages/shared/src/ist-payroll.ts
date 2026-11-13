/**
 * IST payroll calculation engine (BA / PA / PB). Pure and deterministic: no
 * database, no clock, no floating point. Every peso figure is an exact-decimal
 * string and all arithmetic runs in BigInt centavos.
 *
 * NOTHING here is policy. Amounts, targets, the PB rate and the collection gate
 * all arrive in an effective-dated `IstCompensationPolicy`. Without one the
 * result is BLOCKED (`MISSING_POLICY`) and carries no payable figures - a
 * missing configuration must never look like PHP 0.00.
 *
 * Formulas (handoff of 12 Nov 2026, section 4.4), per stretch s (QP or EP) with
 * day factor f_s = eligible days / days in month and monthly threshold T:
 *
 *   PASS_s(T) = f_s > 0 AND KPI_s >= T*f_s AND COLLECTION_s >= gate*T*f_s
 *   BA = monthlyBa * (f_QP [if QP BA is approved] + f_EP * PASS_EP(baTarget))
 *   PA = monthlyPa * (f_QP*PASS_QP(paTarget) + f_EP*PASS_EP(paTarget))
 *   EquivalentTCP_s = PASS_s(pbTarget) ? min(KPI_s, COLLECTION_s/gate) : 0
 *   PB = pbRate * (EquivalentTCP_QP + EquivalentTCP_EP)      (no second proration)
 *   net = max(0, BA + PA + PB - approved BA withholding - authorized adjustments)
 */

export type IstRank = 'SM' | 'SSM' | 'SVD';
const RANKS: readonly string[] = ['SM', 'SSM', 'SVD'];

/** Effective-dated compensation configuration. Supplied by approved policy only. */
export interface IstCompensationPolicy {
  /** Identifier of the approved policy version; copied onto every result. */
  version: string;
  rank: IstRank;
  monthlyBa: string;
  baTarget: string;
  monthlyPa: string;
  paTarget: string;
  pbTarget: string;
  /** Decimal fraction, e.g. '0.01' for 1%. */
  pbRate: string;
  /** Decimal fraction of the target that must be collected, e.g. '0.40'. */
  collectionGate: string;
}

/** Credited figures for one stretch. Built by `creditedTotals`, never typed by hand. */
export interface IstStretchPerformance {
  kpi: string;
  collection: string;
}

export interface IstPayrollInput {
  /** Payroll month, 'YYYY-MM' (natural calendar month, Asia/Manila dates). */
  month: string;
  /** Engagement rank as recorded; anything other than SM/SSM/SVD is not eligible. */
  rank: string;
  /** Contract start 'YYYY-MM-DD' (never the accreditation date). */
  contractStart: string | null;
  /** Last eligible day, inclusive. */
  contractEnd?: string | null;
  /** First day of a rights suspension; pay stops the day before. */
  suspendedFrom?: string | null;
  policy: IstCompensationPolicy | null;
  qp: IstStretchPerformance;
  ep: IstStretchPerformance;
  /**
   * QP Basic Allowance is not production-tested; it depends on an authorized
   * attendance/compliance decision. true = approved, false = withheld by that
   * decision, null = not decided yet (QP BA counts as zero and is flagged).
   */
  qpBaApproved: boolean | null;
  /** An approved, recorded decision to withhold this month's entire BA. */
  baWithheld?: boolean;
  /** Sum of adjustments that are already legally authorized. Never proposed ones. */
  authorizedAdjustments?: string;
}

export type IstPayrollException =
  | 'NOT_AN_IST_POSITION'
  | 'MISSING_POLICY'
  | 'POLICY_RANK_MISMATCH'
  | 'MISSING_CONTRACT_START'
  | 'QP_BA_DECISION_PENDING'
  | 'NON_STANDARD_START_DAY'
  | 'NO_ELIGIBLE_DAYS';

export interface IstStretchResult {
  /** Inclusive eligible range inside the month, or null when the stretch is absent. */
  from: string | null;
  to: string | null;
  days: number;
  baPass: boolean;
  paPass: boolean;
  pbPass: boolean;
  equivalentTcp: string;
}

export interface IstPayrollResult {
  status: 'CALCULATED' | 'BLOCKED';
  exceptions: IstPayrollException[];
  policyVersion: string | null;
  daysInMonth: number;
  qp: IstStretchResult;
  ep: IstStretchResult;
  /** null whenever the result is BLOCKED. */
  ba: string | null;
  pa: string | null;
  pb: string | null;
  gross: string | null;
  baWithheldAmount: string | null;
  authorizedAdjustments: string | null;
  net: string | null;
}

/* ------------------------------------------------------------------ */
/* Exact arithmetic                                                    */
/* ------------------------------------------------------------------ */

const MONEY = /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/;
const FRACTION = /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;

function cents(value: string): bigint {
  if (!MONEY.test(value)) throw new Error(`ist-payroll: not an exact-decimal amount: ${value}`);
  const [whole, frac = ''] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'));
}

function money(value: bigint): string {
  const whole = value / 100n;
  return `${whole}.${(value % 100n).toString().padStart(2, '0')}`;
}

/** A decimal fraction as an exact numerator/denominator. */
function fraction(value: string): { num: bigint; den: bigint } {
  if (!FRACTION.test(value)) throw new Error(`ist-payroll: not a decimal fraction: ${value}`);
  const [whole, frac = ''] = value.split('.');
  return { num: BigInt(whole + frac), den: 10n ** BigInt(frac.length) };
}

/** Round half up to the centavo: num/den, both non-negative. */
function divRound(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (den * 2n);
}

/* ------------------------------------------------------------------ */
/* Calendar (plain dates, no time zones: callers pass Manila dates)     */
/* ------------------------------------------------------------------ */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayNumber(date: string): number {
  const m = DATE.exec(date);
  if (!m) throw new Error(`ist-payroll: not a date: ${date}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(ms);
  if (back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3]))
    throw new Error(`ist-payroll: not a real date: ${date}`);
  return ms / 86_400_000;
}

function dateOf(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Last day of the Qualifying Period: one calendar month after the start, minus
 * one day (16 Jul -> 15 Aug; 1 Apr -> 30 Apr; 31 Jan -> end of Feb).
 */
export function qualifyingPeriodEnd(contractStart: string): string {
  const m = DATE.exec(contractStart);
  if (!m) throw new Error(`ist-payroll: not a date: ${contractStart}`);
  dayNumber(contractStart);
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-12; as a 0-based index this is "next month"
  const day = Number(m[3]);
  const lastOfNext = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const sameDayNextMonth = Date.UTC(year, month, Math.min(day, lastOfNext)) / 86_400_000;
  // When the start day does not exist next month the period ends on that month's last day.
  return dateOf(day > lastOfNext ? sameDayNextMonth : sameDayNextMonth - 1);
}

/* ------------------------------------------------------------------ */
/* Credited totals                                                     */
/* ------------------------------------------------------------------ */

/**
 * Credited KPI and COLLECTION for one stretch. Assumed credit is a performance
 * metric: it raises both credited figures but is never added to verified cash,
 * which is returned unchanged for display and reconciliation.
 */
export function creditedTotals(input: {
  closedDealTcp: string;
  verifiedCollections: string;
  /** Verified receipts on assumed (inherited) accounts in this stretch. */
  assumedAccountCollections: string;
  /** Approved credit rate for those receipts, e.g. '0.40'. '0' disables the credit. */
  assumedCreditRate: string;
}): { kpi: string; collection: string; assumedCredit: string; verifiedCash: string } {
  const rate = fraction(input.assumedCreditRate);
  const credit = divRound(cents(input.assumedAccountCollections) * rate.num, rate.den);
  return {
    kpi: money(cents(input.closedDealTcp) + credit),
    collection: money(cents(input.verifiedCollections) + credit),
    assumedCredit: money(credit),
    verifiedCash: input.verifiedCollections,
  };
}

/* ------------------------------------------------------------------ */
/* The calculation                                                     */
/* ------------------------------------------------------------------ */

const EMPTY: IstStretchResult = {
  from: null,
  to: null,
  days: 0,
  baPass: false,
  paPass: false,
  pbPass: false,
  equivalentTcp: '0.00',
};

export function calculateIstPayroll(input: IstPayrollInput): IstPayrollResult {
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(input.month);
  if (!monthMatch) throw new Error(`ist-payroll: not a month: ${input.month}`);
  const year = Number(monthMatch[1]);
  const monthIndex = Number(monthMatch[2]) - 1;
  const monthStart = Date.UTC(year, monthIndex, 1) / 86_400_000;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const monthEnd = monthStart + daysInMonth - 1;

  const blocked = (exceptions: IstPayrollException[]): IstPayrollResult => ({
    status: 'BLOCKED',
    exceptions,
    policyVersion: input.policy?.version ?? null,
    daysInMonth,
    qp: EMPTY,
    ep: EMPTY,
    ba: null,
    pa: null,
    pb: null,
    gross: null,
    baWithheldAmount: null,
    authorizedAdjustments: null,
    net: null,
  });

  // An OST (or any non-IST position) never receives BA, PA or PB.
  if (!RANKS.includes(input.rank)) return blocked(['NOT_AN_IST_POSITION']);
  const exceptions: IstPayrollException[] = [];
  if (!input.policy) exceptions.push('MISSING_POLICY');
  else if (input.policy.rank !== input.rank) exceptions.push('POLICY_RANK_MISMATCH');
  if (!input.contractStart) exceptions.push('MISSING_CONTRACT_START');
  if (exceptions.length || !input.policy || !input.contractStart) return blocked(exceptions);
  const policy = input.policy;

  // Eligible window inside the month.
  const start = dayNumber(input.contractStart);
  const qpEnd = dayNumber(qualifyingPeriodEnd(input.contractStart));
  let last = monthEnd;
  if (input.contractEnd) last = Math.min(last, dayNumber(input.contractEnd));
  if (input.suspendedFrom) last = Math.min(last, dayNumber(input.suspendedFrom) - 1);
  const first = Math.max(monthStart, start);

  const range = (from: number, to: number) => {
    const a = Math.max(from, first);
    const b = Math.min(to, last);
    return b >= a ? { from: dateOf(a), to: dateOf(b), days: b - a + 1 } : null;
  };
  const qpRange = range(start, qpEnd);
  const epRange = range(qpEnd + 1, Number.MAX_SAFE_INTEGER);

  const startDay = Number(input.contractStart.slice(8, 10));
  if (startDay !== 1 && startDay !== 16) exceptions.push('NON_STANDARD_START_DAY');
  if (!qpRange && !epRange) exceptions.push('NO_ELIGIBLE_DAYS');

  const gate = fraction(policy.collectionGate);
  const total = BigInt(daysInMonth);

  /** PASS_s(T): both the pro-rated KPI line and the pro-rated collection quota. */
  const pass = (days: number, perf: IstStretchPerformance, target: string): boolean => {
    if (days <= 0) return false;
    const d = BigInt(days);
    const t = cents(target);
    return (
      cents(perf.kpi) * total >= t * d &&
      cents(perf.collection) * total * gate.den >= gate.num * t * d
    );
  };

  const stretch = (
    r: { from: string; to: string; days: number } | null,
    perf: IstStretchPerformance,
  ): IstStretchResult => {
    if (!r) return EMPTY;
    const pbPass = pass(r.days, perf, policy.pbTarget);
    let equivalent = 0n;
    if (pbPass) {
      // min(KPI, COLLECTION / gate), rounded to the centavo.
      const fromCollection = divRound(cents(perf.collection) * gate.den, gate.num);
      const kpi = cents(perf.kpi);
      equivalent = kpi < fromCollection ? kpi : fromCollection;
    }
    return {
      ...r,
      baPass: pass(r.days, perf, policy.baTarget),
      paPass: pass(r.days, perf, policy.paTarget),
      pbPass,
      equivalentTcp: money(equivalent),
    };
  };
  const qp = stretch(qpRange, input.qp);
  const ep = stretch(epRange, input.ep);

  // BA: QP days need the compliance decision; EP days need the BA gates.
  if (qp.days > 0 && input.qpBaApproved === null) exceptions.push('QP_BA_DECISION_PENDING');
  const baDays = (input.qpBaApproved === true ? qp.days : 0) + (ep.baPass ? ep.days : 0);
  const paDays = (qp.paPass ? qp.days : 0) + (ep.paPass ? ep.days : 0);
  const ba = divRound(cents(policy.monthlyBa) * BigInt(baDays), total);
  const pa = divRound(cents(policy.monthlyPa) * BigInt(paDays), total);

  const rate = fraction(policy.pbRate);
  const pb = divRound((cents(qp.equivalentTcp) + cents(ep.equivalentTcp)) * rate.num, rate.den);

  const gross = ba + pa + pb;
  const withheld = input.baWithheld ? ba : 0n;
  const adjustments = cents(input.authorizedAdjustments ?? '0.00');
  const netRaw = gross - withheld - adjustments;

  return {
    status: 'CALCULATED',
    exceptions,
    policyVersion: policy.version,
    daysInMonth,
    qp,
    ep,
    ba: money(ba),
    pa: money(pa),
    pb: money(pb),
    gross: money(gross),
    baWithheldAmount: money(withheld),
    authorizedAdjustments: money(adjustments),
    net: money(netRaw > 0n ? netRaw : 0n),
  };
}
