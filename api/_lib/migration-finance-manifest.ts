import {
  commissionStatusSchema,
  paymentStatusSchema,
  paymentSchemeSchema,
  paymentTypeSchema,
  saleStatusSchema,
  hierarchyRoleSchema,
} from '@afhomes/contracts';
import type { MigrationTable } from './migration-mapping.js';
import { addMoney, compareMoney, isExactDecimal } from '@afhomes/shared';

export function reviewedFinanceMigrationTables(): MigrationTable[] {
  const saleUuids = [
    'id',
    'customer_id',
    'plan_id',
    'seller_staff_id',
    'seller_ost_id',
    'referral_relationship_id',
    'created_by',
    'commission_rule_id',
    'import_job_id',
    'import_row_id',
  ];
  const saleTimes = [
    'balance_due_at',
    'created_at',
    'updated_at',
    'submitted_at',
    'payment_verified_at',
    'fully_paid_at',
    'activated_at',
    'cancelled_at',
    'spot_cash_started_at',
    'spot_cash_deadline',
  ];
  const saleMoney = [
    'cash_price',
    'cash_price_snapshot',
    'minimum_down_payment_snapshot',
    'expected_commission_snapshot',
    'reservation_fee_snapshot',
    'required_initial_snapshot',
    'monthly_amount_snapshot',
    'commission_base_snapshot',
  ];
  const saleIntegers = [
    'yearly_points_snapshot',
    'installment_months_snapshot',
    'validity_months_snapshot',
  ];
  const paymentUuids = [
    'id',
    'sale_id',
    'recorded_by',
    'verified_by',
    'customer_id',
    'reservation_id',
  ];
  const commissionUuids = [
    'id',
    'sale_id',
    'ost_id',
    'beneficiary_staff_id',
    'beneficiary_ost_id',
    'qualified_by',
    'paid_by',
    'commission_rule_id',
  ];
  return [
    {
      source: 'public.card_sales',
      target: 'card_sales',
      key: ['id'],
      columns: [
        ...saleUuids,
        ...saleTimes,
        ...saleMoney,
        ...saleIntegers,
        'sale_number',
        'seller_type',
        'status',
        'commission_rate_snapshot',
        'cancellation_reason',
        'payment_scheme',
        'origin',
      ],
      notNull: [
        'id',
        'sale_number',
        'customer_id',
        'plan_id',
        'seller_type',
        'cash_price',
        'balance_due_at',
        'status',
        'created_at',
        'updated_at',
        'payment_scheme',
        'reservation_fee_snapshot',
        'required_initial_snapshot',
        'origin',
      ],
      uuids: saleUuids,
      timestamps: saleTimes,
      int32: saleIntegers,
      money: saleMoney,
      text: [
        'sale_number',
        'seller_type',
        'status',
        'commission_rate_snapshot',
        'cancellation_reason',
        'payment_scheme',
        'origin',
      ],
      references: {
        customer_id: 'public.customers',
        plan_id: 'public.card_plans',
        seller_staff_id: 'public.staff_users',
        seller_ost_id: 'public.ost_members',
        referral_relationship_id: 'public.referral_relationships',
        created_by: 'public.staff_users',
        commission_rule_id: 'public.commission_rules',
        import_job_id: 'public.customer_import_jobs',
        import_row_id: 'public.customer_import_rows',
      },
      unique: [['sale_number']],
      partialUnique: [
        {
          columns: ['customer_id', 'plan_id'],
          when: {
            status: [
              'draft',
              'submitted',
              'payment_pending',
              'payment_in_progress',
              'payment_verified',
              'activation_pending',
            ],
          },
        },
      ],
    },
    {
      source: 'public.payments',
      target: 'payments',
      key: ['id'],
      columns: [
        ...paymentUuids,
        'amount',
        'method',
        'reference',
        'status',
        'recorded_at',
        'verified_at',
        'payment_type',
        'notes',
        'rejection_reason',
        'voided_at',
        'receipt_storage_path',
        'payment_number',
        'origin',
      ],
      notNull: [
        'id',
        'amount',
        'method',
        'status',
        'recorded_by',
        'recorded_at',
        'payment_type',
        'payment_number',
        'origin',
      ],
      uuids: paymentUuids,
      timestamps: ['recorded_at', 'verified_at', 'voided_at'],
      money: ['amount'],
      text: [
        'method',
        'reference',
        'status',
        'payment_type',
        'notes',
        'rejection_reason',
        'receipt_storage_path',
        'payment_number',
        'origin',
      ],
      references: {
        sale_id: 'public.card_sales',
        recorded_by: 'public.staff_users',
        verified_by: 'public.staff_users',
        customer_id: 'public.customers',
        reservation_id: 'public.reservation_agreements',
      },
      unique: [['payment_number'], ['sale_id', 'reference']],
      partialUnique: [
        { columns: ['reservation_id', 'reference'], when: { origin: 'reservation' } },
      ],
    },
    {
      source: 'public.commissions',
      target: 'commissions',
      key: ['id'],
      columns: [
        ...commissionUuids,
        'amount',
        'status',
        'earned_at',
        'paid_at',
        'created_at',
        'beneficiary_type',
        'rate_snapshot',
        'basis_amount_snapshot',
        'qualified_at',
        'qualification_notes',
        'cancelled_at',
        'cancellation_reason',
        'paid_reference',
        'commission_number',
        'settled_before_system',
      ],
      notNull: [
        'id',
        'sale_id',
        'amount',
        'status',
        'created_at',
        'beneficiary_type',
        'commission_number',
        'settled_before_system',
      ],
      uuids: commissionUuids,
      timestamps: ['earned_at', 'paid_at', 'created_at', 'qualified_at', 'cancelled_at'],
      booleans: ['settled_before_system'],
      money: ['amount', 'basis_amount_snapshot'],
      text: [
        'status',
        'beneficiary_type',
        'rate_snapshot',
        'qualification_notes',
        'cancellation_reason',
        'paid_reference',
        'commission_number',
      ],
      references: {
        sale_id: 'public.card_sales',
        ost_id: 'public.ost_members',
        beneficiary_staff_id: 'public.staff_users',
        beneficiary_ost_id: 'public.ost_members',
        qualified_by: 'public.staff_users',
        paid_by: 'public.staff_users',
        commission_rule_id: 'public.commission_rules',
      },
      unique: [['sale_id'], ['commission_number']],
    },
    {
      source: 'public.card_sale_hierarchy_snapshots',
      target: 'card_sale_hierarchy_snapshots',
      key: ['sale_id', 'ancestor_staff_id'],
      columns: ['sale_id', 'ancestor_staff_id', 'ancestor_role', 'depth', 'captured_at'],
      notNull: ['sale_id', 'ancestor_staff_id', 'ancestor_role', 'depth', 'captured_at'],
      uuids: ['sale_id', 'ancestor_staff_id'],
      text: ['ancestor_role'],
      int32: ['depth'],
      timestamps: ['captured_at'],
      references: { sale_id: 'public.card_sales', ancestor_staff_id: 'public.staff_users' },
      unique: [
        ['sale_id', 'ancestor_staff_id'],
        ['sale_id', 'depth'],
      ],
    },
  ];
}

export function migrationFinanceIssues(table: MigrationTable, row: Record<string, unknown>) {
  const issues: { column: string; code: string }[] = [];
  if (
    !['card_sales', 'payments', 'commissions', 'card_sale_hierarchy_snapshots'].includes(
      table.target,
    )
  )
    return issues;
  const fail = (column: string) => issues.push({ column, code: 'INVALID_FINANCE_HISTORY' });
  for (const column of table.money ?? [])
    if (
      row[column] !== null &&
      (typeof row[column] !== 'string' ||
        !/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(row[column] as string))
    )
      fail(column);
  const state =
    table.target === 'card_sales'
      ? saleStatusSchema
      : table.target === 'payments'
        ? paymentStatusSchema
        : table.target === 'commissions'
          ? commissionStatusSchema
          : null;
  if (state && table.columns.includes('status') && !state.safeParse(row.status).success)
    fail('status');
  if (table.target === 'card_sales') {
    if (
      table.columns.includes('payment_scheme') &&
      !paymentSchemeSchema.safeParse(row.payment_scheme).success
    )
      fail('payment_scheme');
    if (
      table.columns.includes('origin') &&
      !['normal', 'legacy_import'].includes(String(row.origin))
    )
      fail('origin');
    if (table.columns.includes('seller_type')) {
      const valid =
        row.seller_type === 'staff'
          ? row.seller_ost_id === null &&
            (row.origin === 'legacy_import' || row.seller_staff_id !== null)
          : row.seller_type === 'ost' && row.seller_ost_id !== null && row.seller_staff_id === null;
      if (!valid) fail('seller_type');
    }
    for (const column of [
      'installment_months_snapshot',
      'validity_months_snapshot',
      'yearly_points_snapshot',
    ])
      if (
        table.columns.includes(column) &&
        typeof row[column] === 'number' &&
        (row[column] as number) < (column === 'yearly_points_snapshot' ? 0 : 1)
      )
        fail(column);
  }
  if (table.target === 'payments') {
    if (
      table.columns.includes('amount') &&
      (typeof row.amount !== 'string' || !/^[1-9][0-9]*(\.[0-9]{1,2})?$/.test(row.amount))
    )
      fail('amount');
    if (
      table.columns.includes('payment_type') &&
      !paymentTypeSchema.safeParse(row.payment_type).success
    )
      fail('payment_type');
    if (
      table.columns.includes('origin') &&
      !(
        (row.origin === 'sale' && row.sale_id !== null && row.reservation_id === null) ||
        (row.origin === 'reservation' && row.reservation_id !== null && row.customer_id !== null)
      )
    )
      fail('origin');
  }
  if (table.target === 'commissions' && table.columns.includes('beneficiary_type')) {
    if (!(
      (row.beneficiary_type === 'staff' &&
        row.beneficiary_staff_id !== null &&
        row.beneficiary_ost_id === null) ||
      (row.beneficiary_type === 'ost' &&
        row.beneficiary_ost_id !== null &&
        row.beneficiary_staff_id === null)
    ))
      fail('beneficiary_type');
  }
  for (const column of table.target === 'card_sales'
    ? ['commission_rate_snapshot']
    : table.target === 'commissions'
      ? ['rate_snapshot']
      : [])
    if (
      table.columns.includes(column) &&
      row[column] !== null &&
      (typeof row[column] !== 'string' ||
        !/^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$/.test(row[column] as string))
    )
      fail(column);
  if (table.target === 'card_sale_hierarchy_snapshots') {
    if (!hierarchyRoleSchema.safeParse(row.ancestor_role).success) fail('ancestor_role');
    if (
      typeof row.depth !== 'number' ||
      !Number.isInteger(row.depth) ||
      row.depth < 0 ||
      row.depth > 3
    )
      fail('depth');
  }
  return issues;
}

/** Reconcile source facts without counting unverified money or recalculating frozen terms. */
export function reconcileSourceFinance(
  source: Record<string, Record<string, unknown>[]>,
  reservations: { id: string; sale_id: string | null; customer_id: string }[],
) {
  const issues: { table: string; row: number | null; code: string; column?: string }[] = [],
    warnings: { table: string; row: number; code: string }[] = [];
  const issue = (table: string, row: number | null, code: string, column?: string) =>
    issues.push({ table, row, code, ...(column ? { column } : {}) });
  for (const table of reviewedFinanceMigrationTables()) {
    if (!Array.isArray(source[table.source])) {
      issue(table.source, null, 'SOURCE_TABLE_REQUIRED');
      continue;
    }
    source[table.source]!.forEach((row, index) => {
      for (const problem of migrationFinanceIssues(table, row))
        issue(table.source, index, problem.code, problem.column);
      for (const column of table.money ?? [])
        if (
          row[column] !== null &&
          (typeof row[column] !== 'string' || !isExactDecimal(row[column] as string))
        )
          issue(table.source, index, 'INVALID_FINANCE_MONEY', column);
    });
  }
  if (issues.length) return { ready: false, issues, warnings };
  const sales = new Map(source['public.card_sales']!.map((sale) => [sale.id, sale]));
  const reserved = new Map(reservations.map((row) => [row.id, row]));
  const totals = new Map<unknown, string>();
  source['public.payments']!.forEach((payment, index) => {
    const sale = payment.sale_id === null ? null : sales.get(payment.sale_id);
    if (payment.sale_id !== null && !sale)
      issue('public.payments', index, 'SALE_REFERENCE_MISSING');
    if (sale && payment.customer_id !== null && payment.customer_id !== sale.customer_id)
      issue('public.payments', index, 'PAYMENT_CUSTOMER_MISMATCH');
    if (payment.origin === 'reservation') {
      const reservation = reserved.get(String(payment.reservation_id));
      if (!reservation) issue('public.payments', index, 'RESERVATION_EVIDENCE_REQUIRED');
      else if (
        reservation.customer_id !== payment.customer_id ||
        (payment.sale_id !== null && reservation.sale_id !== payment.sale_id)
      )
        issue('public.payments', index, 'RESERVATION_PAYMENT_LINK_MISMATCH');
    }
    if (payment.status === 'verified' && sale)
      totals.set(
        payment.sale_id,
        addMoney(totals.get(payment.sale_id) ?? '0.00', payment.amount as string),
      );
  });
  source['public.card_sales']!.forEach((sale, index) => {
    if (typeof sale.cash_price_snapshot !== 'string' || !isExactDecimal(sale.cash_price_snapshot)) {
      issue('public.card_sales', index, 'NATIVE_FROZEN_PRICE_REQUIRED');
      return;
    }
    if (
      sale.status === 'active' &&
      compareMoney(totals.get(sale.id) ?? '0.00', sale.cash_price_snapshot) < 0
    )
      issue('public.card_sales', index, 'ACTIVE_SALE_NOT_FULLY_VERIFIED');
    const memberships = source['public.memberships']?.filter(
      (member) => member.sale_id === sale.id,
    );
    if (sale.status === 'active' && memberships && memberships.length !== 1)
      issue('public.card_sales', index, 'ACTIVE_SALE_MEMBERSHIP_CARDINALITY');
    if (memberships?.some((member) => member.customer_id !== sale.customer_id))
      issue('public.card_sales', index, 'MEMBERSHIP_CUSTOMER_MISMATCH');
    if (
      !source['public.card_sale_hierarchy_snapshots']!.some(
        (snapshot) => snapshot.sale_id === sale.id,
      )
    )
      warnings.push({
        table: 'public.card_sales',
        row: index,
        code: 'HISTORICAL_ANCESTRY_NOT_PRESENT',
      });
  });
  source['public.commissions']!.forEach((commission, index) => {
    const sale = sales.get(commission.sale_id);
    if (!sale) issue('public.commissions', index, 'SALE_REFERENCE_MISSING');
    else if (
      typeof sale.expected_commission_snapshot === 'string' &&
      isExactDecimal(sale.expected_commission_snapshot) &&
      compareMoney(sale.expected_commission_snapshot, commission.amount as string) !== 0
    )
      issue('public.commissions', index, 'FROZEN_COMMISSION_AMOUNT_MISMATCH');
  });
  source['public.card_sale_hierarchy_snapshots']!.forEach((snapshot, index) => {
    if (!sales.has(snapshot.sale_id))
      issue('public.card_sale_hierarchy_snapshots', index, 'SALE_REFERENCE_MISSING');
  });
  return { ready: issues.length === 0, issues, warnings };
}
