import type { MigrationTable } from './migration-mapping.js';
import { customerStatusSchema } from '@afhomes/contracts';

export function reviewedCustomerMigrationTable(): MigrationTable {
  const uuids = ['id', 'auth_user_id', 'created_by', 'referred_by_staff_id'];
  const dates = ['birth_date', 'supplementary_birthday', 'stated_payment_date'];
  const timestamps = ['created_at', 'updated_at'];
  const text = [
    'customer_number',
    'email',
    'phone',
    'first_name',
    'middle_name',
    'last_name',
    'status',
    'suffix',
    'gender',
    'government_id_type',
    'government_id_number',
    'registration_source',
    'referral_code_used',
    'notes',
    'customer_code',
    'ra_number',
    'company_status',
    'citizenship',
    'civil_status',
    'tin_number',
    'occupation_business_name',
    'office_business_address',
    'employed_position',
    'supplementary_full_name',
    'supplementary_address',
    'supplementary_gender',
    'supplementary_citizenship',
    'supplementary_civil_status',
    'supplementary_tin_number',
    'supplementary_mobile',
    'supplementary_email',
    'supplementary_occupation_business_name',
    'supplementary_office_address',
    'supplementary_position',
    'svd_name',
    'ssm_name',
    'sm_name',
    'referrer_name',
    'vip_recommender_name',
    'related_contact_no',
    'related_email',
    'stated_vip_package',
    'stated_payment_terms',
    'stated_regular_price',
    'stated_discount',
    'stated_total_amount',
    'stated_rf',
    'stated_payment_type',
    'stated_ref_no',
    'landline',
    'supplementary_landline',
    'vip_card_number',
  ];
  return {
    source: 'public.customers',
    target: 'customers',
    key: ['id'],
    customerIdentity: true,
    columns: [...uuids, ...dates, ...timestamps, ...text, 'address'],
    notNull: [
      'id',
      'customer_number',
      'email',
      'phone',
      'first_name',
      'last_name',
      'address',
      'status',
      'created_at',
      'updated_at',
      'registration_source',
      'customer_code',
    ],
    uuids,
    dates,
    timestamps,
    text,
    references: { created_by: 'public.staff_users', referred_by_staff_id: 'public.staff_users' },
    // Native government-number uniqueness is stricter than the source type/number pair.
    unique: [
      ['auth_user_id'],
      ['customer_number'],
      ['customer_code'],
      ['email'],
      ['ra_number'],
      ['government_id_number'],
      ['vip_card_number'],
    ],
  };
}
export function migrationCustomerIssues(
  table: MigrationTable,
  row: Record<string, unknown>,
): { column: string; code: string }[] {
  if (table.source !== 'public.customers' && table.target !== 'customers') return [];
  const issues: { column: string; code: string }[] = [];
  const issue = (column: string) => issues.push({ column, code: 'INVALID_CUSTOMER_RECORD' });
  if (table.columns.includes('status') && !customerStatusSchema.safeParse(row.status).success)
    issue('status');
  if (
    table.columns.includes('email') &&
    (typeof row.email !== 'string' || row.email !== row.email.trim().toLowerCase())
  )
    issue('email');
  if (
    table.columns.includes('address') &&
    (!row.address || typeof row.address !== 'object' || Array.isArray(row.address))
  )
    issue('address');
  for (const column of ['gender', 'supplementary_gender'])
    if (
      table.columns.includes(column) &&
      row[column] !== null &&
      !['male', 'female', 'other', 'undisclosed'].some((value) => value === row[column])
    )
      issue(column);
  if (
    table.columns.includes('vip_card_number') &&
    row.vip_card_number !== null &&
    (typeof row.vip_card_number !== 'string' ||
      !/^[0-9]{11}[BGS]1[CT][0-9]{2}[SN]$/.test(row.vip_card_number))
  )
    issue('vip_card_number');
  return issues;
}
