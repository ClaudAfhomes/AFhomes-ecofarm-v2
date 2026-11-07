import {
  customerPointsEntrySchema,
  membershipStatusSchema,
  saleStatusSchema,
} from '@afhomes/contracts';
import type { MigrationTable } from './migration-mapping.js';
import { migrationTimestamp } from './migration-mapping.js';

export function reviewedMembershipPointsMigrationTables(): MigrationTable[] {
  return [
    {
      source: 'public.memberships',
      target: 'memberships',
      key: ['id'],
      columns: [
        'id',
        'customer_id',
        'sale_id',
        'membership_number',
        'fallback_code_hash',
        'status',
        'points_balance',
        'activated_by',
        'activated_at',
        'expires_at',
        'product_id',
        'sale_status_at_activation',
        'yearly_points_allocated',
        'qr_token_hash',
        'renewal_due_at',
        'issued_at',
        'card_issued_at',
        'card_issued_by',
        'last_printed_at',
        'print_count',
        'points_anniversary',
      ],
      notNull: [
        'id',
        'customer_id',
        'sale_id',
        'membership_number',
        'fallback_code_hash',
        'status',
        'points_balance',
        'activated_by',
        'activated_at',
        'expires_at',
        'yearly_points_allocated',
        'issued_at',
        'print_count',
      ],
      uuids: ['id', 'customer_id', 'sale_id', 'activated_by', 'product_id', 'card_issued_by'],
      text: [
        'membership_number',
        'fallback_code_hash',
        'status',
        'sale_status_at_activation',
        'qr_token_hash',
      ],
      bigints: { points_balance: 'safe_integer' },
      int32: ['yearly_points_allocated', 'print_count'],
      timestamps: [
        'activated_at',
        'expires_at',
        'renewal_due_at',
        'issued_at',
        'card_issued_at',
        'last_printed_at',
      ],
      dates: ['points_anniversary'],
      references: {
        customer_id: 'public.customers',
        sale_id: 'public.card_sales',
        activated_by: 'public.staff_users',
        product_id: 'public.card_plans',
        card_issued_by: 'public.staff_users',
      },
      unique: [
        ['customer_id'],
        ['sale_id'],
        ['membership_number'],
        ['fallback_code_hash'],
        ['qr_token_hash'],
      ],
    },
    {
      source: 'public.points_accounts',
      target: 'points_accounts',
      key: ['id'],
      columns: [
        'id',
        'membership_id',
        'balance',
        'lifetime_allocated',
        'lifetime_redeemed',
        'created_at',
        'updated_at',
        'reversal_debt',
        'weekday_balance',
        'weekend_balance',
      ],
      notNull: [
        'id',
        'membership_id',
        'balance',
        'lifetime_allocated',
        'lifetime_redeemed',
        'created_at',
        'updated_at',
        'reversal_debt',
        'weekday_balance',
        'weekend_balance',
      ],
      uuids: ['id', 'membership_id'],
      bigints: {
        balance: 'safe_integer',
        lifetime_allocated: 'safe_integer',
        lifetime_redeemed: 'safe_integer',
        reversal_debt: 'safe_integer',
        weekday_balance: 'safe_integer',
        weekend_balance: 'safe_integer',
      },
      timestamps: ['created_at', 'updated_at'],
      references: { membership_id: 'public.memberships' },
      unique: [['membership_id']],
    },
    {
      source: 'public.points_periods',
      target: 'points_periods',
      key: ['id'],
      columns: [
        'id',
        'account_id',
        'period_start',
        'period_end',
        'tier',
        'annual_points_cap',
        'opening_balance',
        'closing_balance',
        'status',
        'reset_at',
        'reset_source',
        'reset_actor_id',
        'authoritative_from',
        'created_at',
      ],
      notNull: [
        'id',
        'account_id',
        'period_start',
        'period_end',
        'tier',
        'annual_points_cap',
        'status',
        'created_at',
      ],
      uuids: ['id', 'account_id', 'reset_actor_id'],
      text: ['tier', 'status', 'reset_source'],
      bigints: {
        annual_points_cap: 'safe_integer',
        opening_balance: 'safe_integer',
        closing_balance: 'safe_integer',
      },
      dates: ['period_start', 'period_end', 'authoritative_from'],
      timestamps: ['reset_at', 'created_at'],
      references: { account_id: 'public.points_accounts', reset_actor_id: 'public.staff_users' },
      unique: [['account_id', 'period_start']],
    },
    {
      source: 'public.points_ledger',
      target: 'points_ledger',
      key: ['id'],
      columns: [
        'id',
        'account_id',
        'entry_type',
        'amount',
        'balance_after',
        'reference_type',
        'reference_id',
        'actor_id',
        'reason',
        'metadata',
        'created_at',
        'balance_before',
        'counts_toward_cap',
        'origin_award_id',
        'origin_period_id',
        'weekday_delta',
        'weekend_delta',
      ],
      notNull: [
        'id',
        'account_id',
        'entry_type',
        'amount',
        'balance_after',
        'metadata',
        'created_at',
        'counts_toward_cap',
      ],
      uuids: ['account_id', 'actor_id', 'origin_period_id'],
      text: ['entry_type', 'reference_type', 'reference_id', 'reason'],
      bigints: {
        id: 'identifier',
        amount: 'safe_integer',
        balance_after: 'safe_integer',
        balance_before: 'safe_integer',
        origin_award_id: 'identifier',
        weekday_delta: 'safe_integer',
        weekend_delta: 'safe_integer',
      },
      booleans: ['counts_toward_cap'],
      timestamps: ['created_at'],
      references: {
        account_id: 'public.points_accounts',
        actor_id: 'public.staff_users',
        origin_award_id: 'public.points_ledger',
        origin_period_id: 'public.points_periods',
      },
      partialUnique: [
        { columns: ['account_id', 'reference_id'], when: { entry_type: 'annual_allocation' } },
        {
          columns: ['reference_id'],
          when: { entry_type: 'earned', reference_type: 'earning_claim' },
        },
      ],
    },
  ];
}

export function migrationPointsIssues(table: MigrationTable, row: Record<string, unknown>) {
  const issues: { column: string; code: string }[] = [];
  const fail = (column: string) => issues.push({ column, code: 'INVALID_POINTS_HISTORY' });
  const integer = (column: string) =>
    typeof row[column] === 'string' && /^(0|-?[1-9]\d*)$/.test(row[column] as string)
      ? BigInt(row[column] as string)
      : null;
  const nonnegative = (columns: string[]) => {
    for (const column of columns)
      if (table.columns.includes(column) && (integer(column) ?? 0n) < 0n) fail(column);
  };
  if (table.target === 'memberships') {
    if (table.columns.includes('status') && !membershipStatusSchema.safeParse(row.status).success)
      fail('status');
    if (
      table.columns.includes('sale_status_at_activation') &&
      row.sale_status_at_activation !== null &&
      !saleStatusSchema.safeParse(row.sale_status_at_activation).success
    )
      fail('sale_status_at_activation');
    for (const column of ['fallback_code_hash', 'qr_token_hash'])
      if (
        table.columns.includes(column) &&
        row[column] !== null &&
        (typeof row[column] !== 'string' || !/^[a-f0-9]{64}$/.test(row[column] as string))
      )
        fail(column);
    for (const column of ['yearly_points_allocated', 'print_count'])
      if (table.columns.includes(column) && typeof row[column] === 'number' && row[column] < 0)
        fail(column);
    nonnegative(['points_balance']);
  }
  if (table.target === 'points_accounts') {
    nonnegative(['balance', 'lifetime_allocated', 'lifetime_redeemed', 'reversal_debt']);
    const values = ['balance', 'reversal_debt', 'weekday_balance', 'weekend_balance'].map(integer);
    if (
      values.every((value) => value !== null) &&
      values[2]! + values[3]! !== values[0]! - values[1]!
    )
      fail('weekday_balance');
  }
  if (table.target === 'points_periods') {
    nonnegative(['opening_balance', 'closing_balance']);
    if (table.columns.includes('annual_points_cap') && (integer('annual_points_cap') ?? 0n) <= 0n)
      fail('annual_points_cap');
    if (
      typeof row.period_start === 'string' &&
      typeof row.period_end === 'string' &&
      row.period_start >= row.period_end
    )
      fail('period_end');
    for (const [column, options] of [
      ['tier', ['BRONZE', 'SILVER', 'GOLD']],
      ['status', ['open', 'reset']],
      ['reset_source', [null, 'automatic', 'staff', 'admin']],
    ] as const)
      if (table.columns.includes(column) && !options.some((value) => value === row[column]))
        fail(column);
  }
  if (table.target === 'points_ledger') {
    nonnegative(['balance_before', 'balance_after']);
    if (table.columns.includes('amount') && integer('amount') === 0n) fail('amount');
    if (
      table.columns.includes('entry_type') &&
      !customerPointsEntrySchema.shape.entryType.safeParse(row.entry_type).success
    )
      fail('entry_type');
    if (
      table.columns.includes('metadata') &&
      (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata))
    )
      fail('metadata');
    if (table.columns.includes('weekday_delta') && table.columns.includes('weekend_delta')) {
      const weekday = integer('weekday_delta'),
        weekend = integer('weekend_delta'),
        amount = integer('amount');
      if (
        (row.weekday_delta === null) !== (row.weekend_delta === null) ||
        (weekday !== null && weekend !== null && amount !== null && weekday + weekend !== amount)
      )
        fail('weekday_delta');
    }
  }
  return issues;
}

/** Read-only source checks; never rebuild balances, allocations or missing history. */
export function reconcileSourceMembershipPoints(source: Record<string, Record<string, unknown>[]>) {
  const issues: { table: string; row: number | null; column?: string; code: string }[] = [];
  const tables = reviewedMembershipPointsMigrationTables();
  const maps = new Map<string, Map<string, Record<string, unknown>>>();
  const issue = (table: string, row: number | null, code: string, column?: string) =>
    issues.push({ table, row, code, ...(column ? { column } : {}) });
  for (const table of tables) {
    if (!Array.isArray(source[table.source])) {
      issue(table.source, null, 'SOURCE_TABLE_REQUIRED');
      continue;
    }
    const rows = new Map<string, Record<string, unknown>>();
    maps.set(table.source, rows);
    source[table.source]!.forEach((row, index) => {
      if (typeof row.id !== 'string' || rows.has(row.id))
        issue(table.source, index, 'DUPLICATE_OR_INVALID_SOURCE_KEY');
      else rows.set(row.id, row);
      for (const problem of migrationPointsIssues(table, row))
        issue(table.source, index, problem.code, problem.column);
    });
  }
  if (issues.length) return { ready: false, issues };
  const memberships = maps.get('public.memberships')!,
    accounts = maps.get('public.points_accounts')!,
    periods = maps.get('public.points_periods')!,
    ledger = maps.get('public.points_ledger')!;
  const sameInteger = (a: unknown, b: unknown) =>
    typeof a === 'string' &&
    typeof b === 'string' &&
    /^(0|-?[1-9]\d*)$/.test(a) &&
    /^(0|-?[1-9]\d*)$/.test(b) &&
    BigInt(a) === BigInt(b);
  source['public.memberships']!.forEach((member, index) => {
    const matching = [...accounts.values()].filter(
      (account) => account.membership_id === member.id,
    );
    if (matching.length !== 1) issue('public.memberships', index, 'POINTS_ACCOUNT_CARDINALITY');
    else if (!sameInteger(member.points_balance, matching[0]!.balance))
      issue('public.memberships', index, 'MEMBERSHIP_POINTS_MISMATCH');
  });
  source['public.points_accounts']!.forEach((account, index) => {
    if (!memberships.has(String(account.membership_id)))
      issue('public.points_accounts', index, 'MEMBERSHIP_REFERENCE_MISSING');
  });
  source['public.points_periods']!.forEach((period, index) => {
    if (!accounts.has(String(period.account_id)))
      issue('public.points_periods', index, 'ACCOUNT_REFERENCE_MISSING');
  });
  const latest = new Map<string, { row: Record<string, unknown>; instant: bigint; id: bigint }>();
  source['public.points_ledger']!.forEach((entry, index) => {
    const account = String(entry.account_id);
    if (!accounts.has(account)) issue('public.points_ledger', index, 'ACCOUNT_REFERENCE_MISSING');
    for (const [column, parent] of [
      ['origin_period_id', periods],
      ['origin_award_id', ledger],
    ] as const) {
      if (entry[column] == null) continue;
      const original = parent.get(String(entry[column]));
      if (!original || original.account_id !== entry.account_id)
        issue('public.points_ledger', index, 'CROSS_ACCOUNT_OR_MISSING_ORIGIN', column);
    }
    const timestamp = migrationTimestamp(entry.created_at, 'preserve-source');
    if (
      'error' in timestamp ||
      typeof entry.id !== 'string' ||
      !/^(0|-?[1-9]\d*)$/.test(entry.id)
    ) {
      issue('public.points_ledger', index, 'INVALID_LEDGER_ORDER');
      return;
    }
    const fractional = /\.(\d{1,6})(?:Z|[+-])/.exec(String(entry.created_at))?.[1] ?? '';
    const instant =
      BigInt(Date.parse(timestamp.value)) * 1000n + BigInt(fractional.padEnd(6, '0').slice(3));
    const id = BigInt(entry.id),
      previous = latest.get(account);
    if (
      !previous ||
      instant > previous.instant ||
      (instant === previous.instant && id > previous.id)
    )
      latest.set(account, { row: entry, instant, id });
  });
  source['public.points_accounts']!.forEach((account, index) => {
    const entry = latest.get(String(account.id));
    if (entry && !sameInteger(account.balance, entry.row.balance_after))
      issue('public.points_accounts', index, 'LATEST_LEDGER_BALANCE_MISMATCH');
  });
  return { ready: issues.length === 0, issues };
}
