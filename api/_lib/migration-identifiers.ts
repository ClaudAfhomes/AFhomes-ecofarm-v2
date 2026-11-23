import type { MigrationTable } from './migration-mapping.js';
export function reviewedIdentifierAndDisabledHistoryTables(): MigrationTable[] {
  return [
    {
      source: 'private.vip_card_number_issuances',
      target: 'vip_card_number_issuances',
      key: ['vip_card_number'],
      columns: ['vip_card_number', 'customer_id', 'recorded_at'],
      notNull: ['vip_card_number', 'customer_id', 'recorded_at'],
      text: ['vip_card_number'],
      uuids: ['customer_id'],
      timestamps: ['recorded_at'],
      renames: { customer_id: 'source_customer_id' },
      unique: [['vip_card_number']],
    },
    {
      source: 'public.redemption_items',
      target: 'migration_source_redemption_items',
      key: ['id'],
      columns: [
        'id',
        'code',
        'name',
        'description',
        'category',
        'points_cost',
        'is_active',
        'sort_order',
        'created_at',
        'updated_at',
      ],
      notNull: [
        'id',
        'code',
        'name',
        'category',
        'points_cost',
        'is_active',
        'sort_order',
        'created_at',
        'updated_at',
      ],
      uuids: ['id'],
      text: ['code', 'name', 'description', 'category'],
      bigints: { points_cost: 'safe_integer' },
      booleans: ['is_active'],
      int32: ['sort_order'],
      timestamps: ['created_at', 'updated_at'],
      unique: [['code']],
    },
  ];
}
export function migrationIdentifierIssues(table: MigrationTable, row: Record<string, unknown>) {
  const issues: { column: string; code: string }[] = [];
  if (
    table.source === 'private.vip_card_number_issuances' &&
    table.columns.includes('vip_card_number') &&
    (typeof row.vip_card_number !== 'string' ||
      !/^\d{6}\d{5}[BGS]1[CT]\d{2}[SN]$/.test(row.vip_card_number))
  )
    issues.push({ column: 'vip_card_number', code: 'INVALID_RETIRED_VIP_IDENTIFIER' });
  if (
    table.source === 'public.redemption_items' &&
    table.columns.includes('points_cost') &&
    (typeof row.points_cost !== 'string' ||
      !/^[1-9]\d*$/.test(row.points_cost) ||
      BigInt(row.points_cost) > 1000000000n)
  )
    issues.push({ column: 'points_cost', code: 'INVALID_REDEMPTION_HISTORY_COST' });
  return issues;
}
