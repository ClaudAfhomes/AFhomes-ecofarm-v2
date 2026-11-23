import type { MigrationTable } from './migration-mapping.js';
import { aaNumberSchema, hierarchyRoleSchema } from '@afhomes/contracts';

export function reviewedNetworkMigrationTables(): MigrationTable[] {
  return [
    {
      source: 'public.referral_relationships',
      target: 'referral_relationships',
      key: ['id'],
      columns: [
        'id',
        'subject_staff_id',
        'upline_staff_id',
        'hierarchy_role',
        'is_authoritative',
        'is_active',
        'assigned_by',
        'assigned_at',
        'created_at',
        'updated_at',
      ],
      notNull: [
        'id',
        'subject_staff_id',
        'upline_staff_id',
        'hierarchy_role',
        'is_authoritative',
        'is_active',
        'assigned_at',
        'created_at',
        'updated_at',
      ],
      uuids: ['id', 'subject_staff_id', 'upline_staff_id', 'assigned_by'],
      text: ['hierarchy_role'],
      booleans: ['is_authoritative', 'is_active'],
      timestamps: ['assigned_at', 'created_at', 'updated_at'],
      ownerField: 'subject_staff_id',
      references: {
        subject_staff_id: 'public.staff_users',
        upline_staff_id: 'public.staff_users',
        assigned_by: 'public.staff_users',
      },
      partialUnique: [{ columns: ['subject_staff_id'], when: { is_active: true } }],
    },
    {
      source: 'private.sale_team_accreditations',
      target: 'sale_team_accreditations',
      key: ['staff_id'],
      ownerField: 'staff_id',
      columns: [
        'staff_id',
        'aa_number',
        'public_name',
        'kind',
        'status',
        'starts_on',
        'expires_on',
        'approved_by',
        'approved_at',
        'revoked_by',
        'revoked_at',
      ],
      notNull: [
        'staff_id',
        'aa_number',
        'public_name',
        'kind',
        'status',
        'approved_by',
        'approved_at',
      ],
      uuids: ['staff_id', 'approved_by', 'revoked_by'],
      text: ['aa_number', 'public_name', 'kind', 'status'],
      dates: ['starts_on', 'expires_on'],
      timestamps: ['approved_at', 'revoked_at'],
      references: {
        staff_id: 'public.staff_users',
        approved_by: 'public.staff_users',
        revoked_by: 'public.staff_users',
      },
      referenceMatch: ['staff_id'],
      unique: [['staff_id'], ['aa_number']],
    },
    {
      source: 'private.sale_team_accreditation_history',
      target: 'sale_team_accreditation_history',
      key: ['id'],
      columns: [
        'id',
        'staff_id',
        'aa_number',
        'kind',
        'public_name',
        'starts_on',
        'expires_on',
        'status',
        'event',
        'successor_aa_number',
        'reason',
        'recorded_by',
        'recorded_at',
      ],
      notNull: [
        'id',
        'staff_id',
        'aa_number',
        'kind',
        'public_name',
        'status',
        'event',
        'recorded_by',
        'recorded_at',
      ],
      uuids: ['id', 'staff_id', 'recorded_by'],
      text: [
        'aa_number',
        'kind',
        'public_name',
        'status',
        'event',
        'successor_aa_number',
        'reason',
      ],
      dates: ['starts_on', 'expires_on'],
      timestamps: ['recorded_at'],
      references: { staff_id: 'public.staff_users', recorded_by: 'public.staff_users' },
      // Source event is fixed to transferred, so native AA uniqueness preserves the source AA/event key.
      unique: [['aa_number']],
    },
  ];
}
export function migrationNetworkIssues(
  table: MigrationTable,
  row: Record<string, unknown>,
): { column: string; code: string }[] {
  const issues: { column: string; code: string }[] = [];
  const invalid = (column: string) => issues.push({ column, code: 'INVALID_NETWORK_RECORD' });
  if (table.target === 'referral_relationships') {
    if (!hierarchyRoleSchema.safeParse(row.hierarchy_role).success) invalid('hierarchy_role');
    if (row.subject_staff_id === row.upline_staff_id) invalid('upline_staff_id');
  }
  if (['sale_team_accreditations', 'sale_team_accreditation_history'].includes(table.target)) {
    const parsed = aaNumberSchema.safeParse(row.aa_number);
    if (
      !parsed.success ||
      parsed.data !== row.aa_number ||
      (String(row.aa_number).startsWith('AAI') && row.kind !== 'IST') ||
      (String(row.aa_number).startsWith('AAO') && row.kind !== 'OST')
    )
      invalid('aa_number');
    if (!['IST', 'OST'].some((kind) => kind === row.kind)) invalid('kind');
    const dated = row.starts_on !== null && row.expires_on !== null;
    if (
      (row.kind === 'OST' && !dated) ||
      (row.kind === 'IST' && !dated && (row.starts_on !== null || row.expires_on !== null))
    )
      invalid('starts_on');
    if (
      typeof row.starts_on === 'string' &&
      typeof row.expires_on === 'string' &&
      row.expires_on < row.starts_on
    )
      invalid('expires_on');
    if (table.target === 'sale_team_accreditations') {
      if (!['active', 'revoked'].some((status) => status === row.status)) invalid('status');
    } else {
      if (row.status !== 'superseded') invalid('status');
      if (row.event !== 'transferred') invalid('event');
      if (
        row.successor_aa_number !== null &&
        (row.successor_aa_number === row.aa_number ||
          !aaNumberSchema.safeParse(row.successor_aa_number).success)
      )
        invalid('successor_aa_number');
    }
  }
  return issues;
}
