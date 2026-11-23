import type { MigrationTable } from './migration-mapping.js';

export function reviewedPointsTierMigrationTable(): MigrationTable {
  return {
    source: 'public.tier_points_config',
    target: 'tier_points_config',
    key: ['tier'],
    columns: ['tier', 'annual_points_cap', 'updated_at', 'updated_by'],
    notNull: ['tier', 'annual_points_cap', 'updated_at'],
    text: ['tier'],
    bigints: { annual_points_cap: 'safe_integer' },
    uuids: ['updated_by'],
    timestamps: ['updated_at'],
    references: { updated_by: 'public.staff_users' },
    referenceMatch: ['tier'],
    unique: [['tier']],
  };
}

export function reviewedCatalogMigrationTables(): MigrationTable[] {
  const planText = [
    'code',
    'name',
    'cash_price',
    'minimum_down_payment',
    'commission_rate',
    'installment_price',
    'reservation_fee',
    'total_loyalty_value',
    'description',
  ];
  const planIntegers = [
    'yearly_points',
    'sort_order',
    'spot_cash_days',
    'standard_installment_months',
    'validity_years',
    'discount_percent',
    'base_validity_years',
    'validity_extension_years',
    'cardholder_limit',
    'annual_points_tranches',
  ];
  const planBooleans = [
    'is_active',
    'move_a_enabled',
    'move_b1_enabled',
    'move_b2_enabled',
    'priority_reservation',
    'no_monthly_annual_dues',
  ];
  const planColumns = [
    'id',
    'category_id',
    ...planText,
    ...planIntegers,
    ...planBooleans,
    'created_at',
    'updated_at',
  ];
  const money = [
    'cash_price',
    'minimum_down_payment',
    'installment_price',
    'reservation_fee',
    'total_loyalty_value',
  ];
  return [
    {
      source: 'public.card_categories',
      target: 'card_categories',
      key: ['id'],
      columns: ['id', 'slug', 'name', 'description', 'is_active', 'sort_order'],
      notNull: ['id', 'slug', 'name', 'is_active', 'sort_order'],
      uuids: ['id'],
      text: ['slug', 'name', 'description'],
      booleans: ['is_active'],
      int32: ['sort_order'],
      referenceMatch: ['slug'],
      unique: [['slug'], ['name']],
    },
    {
      source: 'public.card_plans',
      target: 'card_plans',
      key: ['id'],
      columns: planColumns,
      notNull: planColumns.filter((column) => column !== 'description'),
      uuids: ['id', 'category_id'],
      text: planText.filter((column) => !money.includes(column)),
      int32: planIntegers,
      booleans: planBooleans,
      timestamps: ['created_at', 'updated_at'],
      money,
      references: { category_id: 'public.card_categories' },
      requiredReferences: ['category_id'],
      referenceMatch: ['code'],
      unique: [['code']],
    },
  ];
}
