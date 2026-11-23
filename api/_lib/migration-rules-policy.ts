import type { MigrationTable } from './migration-mapping.js';
import { reviewedRulesAndPolicyTables } from './migration-rules-policy-tables.js';
export { reviewedRulesAndPolicyTables } from './migration-rules-policy-tables.js';

const targets = { role: 'target_role_id', staff: 'target_staff_id', ost: 'target_ost_id' } as const;
export const commissionRuleTargetColumn = (type: unknown) =>
  typeof type === 'string' ? targets[type as keyof typeof targets] : undefined;
const policyTargets: Record<string, string> = {
  'private.public_verification_settings': 'migration_source_public_verification_settings',
  'private.staff_security_policy': 'migration_source_staff_security_policy',
};
export function rulesPolicyMappingIssues(table: MigrationTable) {
  const issues: string[] = [];
  if (policyTargets[table.source] && table.target !== policyTargets[table.source])
    issues.push('SOURCE_POLICY_REQUIRES_HISTORY_TARGET');
  if (table.source === 'public.commission_rules' && table.columns.includes('target_type')) {
    if (
      table.target !== 'commission_rules' ||
      table.references?.target_id ||
      table.references?.target_role_id !== 'public.roles' ||
      table.references?.target_staff_id !== 'public.staff_users' ||
      table.references?.target_ost_id !== 'public.ost_members'
    )
      issues.push('COMMISSION_TARGET_MAPPING_REQUIRED');
  }
  return issues;
}

export function migrationRulePolicyIssues(table: MigrationTable, row: Record<string, unknown>) {
  const issues: { column: string; code: string }[] = [];
  const fail = (column: string) => {
    if (table.columns.includes(column))
      issues.push({ column, code: 'INVALID_RULE_OR_POLICY_HISTORY' });
  };
  if (table.source === 'public.commission_rules' && table.target === 'commission_rules') {
    const target = commissionRuleTargetColumn(row.target_type);
    if (!target) fail('target_type');
    if (
      target &&
      (row[target] !== row.target_id ||
        row.target_id == null ||
        Object.values(targets).some((column) => column !== target && row[column] !== null))
    )
      fail('target_id');
    if (typeof row.rate !== 'string' || !/^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$/.test(row.rate))
      fail('rate');
    if (row.effective_until !== null && String(row.effective_until) < String(row.effective_from))
      fail('effective_until');
  }
  if (policyTargets[table.source]) {
    if (row.singleton !== true) fail('singleton');
    if (table.source === 'private.public_verification_settings') {
      const notice = row.privacy_notice;
      if (
        typeof notice !== 'string' ||
        [...notice].length < 100 ||
        [...notice].length > 20000 ||
        /\[Insert|(?<![\p{L}\p{N}_])TBD(?![\p{L}\p{N}_])/u.test(notice)
      )
        fail('privacy_notice');
      if (
        !Number.isInteger(row.retention_days) ||
        Number(row.retention_days) < 1 ||
        Number(row.retention_days) > 3650
      )
        fail('retention_days');
      if (!Number.isInteger(row.revision) || Number(row.revision) < 1) fail('revision');
      if (
        typeof row.support_email !== 'string' ||
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.support_email)
      )
        fail('support_email');
      for (const column of ['support_phone', 'verification_phone'])
        if (typeof row[column] !== 'string' || !/^\+?[0-9 ()-]{7,30}$/.test(row[column] as string))
          fail(column);
    }
  }
  return issues;
}

export function commissionRuleOverlaps(
  candidate: Record<string, unknown>,
  existing: Record<string, unknown>[],
) {
  return (
    candidate.is_active === true &&
    existing.some(
      (row) =>
        row._id !== candidate._id &&
        row.is_active === true &&
        row.target_type === candidate.target_type &&
        row.target_id === candidate.target_id &&
        String(row.effective_from) <= String(candidate.effective_until ?? '9999-12-31') &&
        String(candidate.effective_from) <= String(row.effective_until ?? '9999-12-31'),
    )
  );
}

export function reconcileSourceRulesAndPolicies(source: Record<string, Record<string, unknown>[]>) {
  const issues: { table: string; row: number; code: string }[] = [];
  const definitions = reviewedRulesAndPolicyTables();
  for (const table of definitions) {
    const rows = source[table.source];
    if (!rows) {
      issues.push({ table: table.source, row: -1, code: 'SOURCE_RULE_POLICY_TABLE_REQUIRED' });
      continue;
    }
    for (const [index, row] of rows.entries()) {
      for (const issue of migrationRulePolicyIssues(table, row))
        issues.push({ table: table.source, row: index, code: issue.code });
      for (const [column, parent] of Object.entries(table.references ?? {}))
        if (
          row[column] != null &&
          !source[parent]?.some((candidate) => candidate.id === row[column])
        )
          issues.push({ table: table.source, row: index, code: 'RULE_SOURCE_REFERENCE_MISSING' });
      if (
        table.source === 'public.commission_rules' &&
        commissionRuleOverlaps(
          { ...row, _id: row.id },
          rows.map((other) => ({ ...other, _id: other.id })),
        )
      )
        issues.push({ table: table.source, row: index, code: 'COMMISSION_RULE_RANGE_CONFLICT' });
    }
  }
  return {
    ready: issues.length === 0,
    issues,
    commissionRules: source['public.commission_rules']?.length ?? 0,
    policySnapshots:
      (source['private.public_verification_settings']?.length ?? 0) +
      (source['private.staff_security_policy']?.length ?? 0),
    runtimePolicyChanged: false,
    privacyApprovalTransferred: false,
    mfaRequirementTransferred: false,
  };
}
