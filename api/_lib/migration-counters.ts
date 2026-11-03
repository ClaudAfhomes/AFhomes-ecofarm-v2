import { z } from 'zod';
import { migrationTimestamp } from './migration-mapping.js';
import { purchaseFingerprint } from './purchase-fingerprint.js';

const inputSchema = z
  .object({
    company: z.array(
      z
        .object({
          issue_year: z.number().int().min(1).max(9999),
          last_issued: z.number().int().min(0).max(2147483647),
        })
        .strict(),
    ),
    accreditation: z.array(
      z
        .object({ accreditation_month: z.string(), last_value: z.number().int().min(1).max(9999) })
        .strict(),
    ),
    target: z.array(
      z
        .object({
          _id: z.string().min(1),
          seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        })
        .strict(),
    ),
    issued: z
      .object({
        company: z.array(z.string()),
        accreditation: z.array(z.string()),
        vip: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

/** Pure high-water plan; callers must inventory current AND retired issued identifiers. */
export function planMigrationCounters(input: z.infer<typeof inputSchema>) {
  const issues: { row: number | null; code: string }[] = [];
  const issue = (code: string, row: number | null = null) => issues.push({ row, code });
  const proposed = new Map<string, number>();
  const limits = new Map<string, number>();
  const raise = (key: string, seq: number, limit: number) => {
    limits.set(key, limit);
    proposed.set(key, Math.max(proposed.get(key) ?? 0, seq));
  };
  if (!inputSchema.safeParse(input).success)
    return {
      ready: false,
      changes: [],
      issues: [{ row: null, code: 'INVALID_COUNTER_PROJECTION' }],
      digest: purchaseFingerprint('invalid-counter-projection'),
    };
  const sourceYears = new Set<number>();
  input.company.forEach((row, index) => {
    if (sourceYears.has(row.issue_year)) issue('DUPLICATE_COMPANY_COUNTER', index);
    sourceYears.add(row.issue_year);
    raise(
      `company-customer:${String(row.issue_year).padStart(4, '0')}`,
      row.last_issued,
      2147483647,
    );
  });
  const months = new Map<string, string>();
  input.accreditation.forEach((row, index) => {
    if (
      !/^\d{4}-\d{2}-01$/.test(row.accreditation_month) ||
      'error' in migrationTimestamp(`${row.accreditation_month}T00:00:00Z`)
    ) {
      issue('INVALID_ACCREDITATION_MONTH', index);
      return;
    }
    const stamp = row.accreditation_month.slice(2, 4) + row.accreditation_month.slice(5, 7);
    if (months.has(stamp)) issue('AMBIGUOUS_ACCREDITATION_COUNTER', index);
    months.set(stamp, row.accreditation_month);
    raise(`sale-team-aa:${stamp}`, row.last_value, 9999);
  });
  input.issued.company.forEach((value, index) => {
    const match = /^(\d{4})-(\d{4,})$/.exec(value) ?? /^AF-CUS-(\d{4})-(\d{6})$/.exec(value);
    const seq = match ? Number(match[2]) : NaN;
    if (!match || match[1] === '0000' || !Number.isSafeInteger(seq) || seq > 2147483647)
      issue('INVALID_COMPANY_IDENTIFIER', index);
    else raise(`company-customer:${match[1]}`, seq, 2147483647);
  });
  input.issued.accreditation.forEach((value, index) => {
    const match = /^AA[IO](\d{2}(?:0[1-9]|1[0-2]))(\d{4})$/.exec(value);
    if (!match || Number(match[2]) < 1) issue('INVALID_ACCREDITATION_IDENTIFIER', index);
    else raise(`sale-team-aa:${match[1]}`, Number(match[2]), 9999);
  });
  input.issued.vip.forEach((value, index) => {
    const match = /^\d{6}(\d{5})[BGS]1[CT]\d{2}[SN]$/.exec(value);
    if (!match) issue('INVALID_VIP_IDENTIFIER', index);
    else raise('vip-card-number', Number(match[1]), 99999);
  });
  const current = new Map<string, number>();
  input.target.forEach((row, index) => {
    if (current.has(row._id)) issue('DUPLICATE_TARGET_COUNTER', index);
    current.set(row._id, row.seq);
    const limit =
      row._id === 'vip-card-number'
        ? 99999
        : /^sale-team-aa:\d{2}(0[1-9]|1[0-2])$/.test(row._id)
          ? 9999
          : /^company-customer:\d{4}$/.test(row._id)
            ? 2147483647
            : null;
    if (limit !== null && row.seq > limit) issue('COUNTER_OUT_OF_RANGE', index);
    if (proposed.has(row._id)) raise(row._id, row.seq, limits.get(row._id)!);
  });
  for (const [key, seq] of proposed) if (seq > limits.get(key)!) issue('COUNTER_OUT_OF_RANGE');
  const changes = [...proposed]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, seq]) =>
      current.get(key) === seq ? [] : [{ _id: key, previous: current.get(key) ?? null, seq }],
    );
  return {
    ready: issues.length === 0,
    changes: issues.length ? [] : changes,
    issues,
    digest: purchaseFingerprint({ input, changes, issues }),
  };
}
