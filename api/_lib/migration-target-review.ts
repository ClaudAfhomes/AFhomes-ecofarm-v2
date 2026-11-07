import type { Db } from 'mongodb';
import type { SourceArchive } from './migration-source-archive.js';
import { reviewedBusinessMigrationTables } from './migration-reviewed-manifest.js';
import { decodeMigrationSourceRows } from './migration-source-decode.js';
import { planMigrationMapping, migrationTimestamp, migrationSourceRowKey, migrationReferenceMetadataColumns, type MigrationReferenceReuse, type MigrationRecord } from './migration-mapping.js';
import { migrationFingerprint } from './migration-fingerprint.js';
import { planMigrationLedgerIds } from './migration-ledger-ids.js';
import { planMigrationDepartmentSetup } from './migration-department-setup.js';
import {
  planMigrationIdentities,
  type SourceMigrationIdentity,
  type MigrationIdentityBinding,
} from './migration-identity-plan.js';
import type { MigrationIdentitySnapshots } from './migration-identity-references.js';

/** Read-only target comparison. Credentials stay in memory and are never returned or logged. */
export async function reviewNativeMigrationTarget(db: Db, archive: SourceArchive) {
  if (db.databaseName !== 'afhomes_dev') throw new Error('Target review scope must be afhomes_dev');
  const tables = reviewedBusinessMigrationTables(),
    decoded = decodeMigrationSourceRows(archive, { tables });
  if (!decoded.ready) throw new Error('Source decode requires review');
  const source = decoded.source;
  const roles = source['public.roles']!.filter((row) => row.slug === 'super_admin').map(
    (row) => row.id,
  );
  const sourceOwners = source['public.staff_role_assignments']!.filter((row) =>
    roles.includes(row.role_id),
  );
  if (sourceOwners.length !== 1) throw new Error('Source owner requires explicit review');
  const ownerRow = await db
    .collection<MigrationRecord>('admin_bootstrap')
    .findOne({ _id: 'initial-super-admin' });
  if (typeof ownerRow?.user_id !== 'string') throw new Error('Existing bootstrap owner required');
  const owner = { sourceId: String(sourceOwners[0]!.staff_id), targetId: ownerRow.user_id };
  const sourceAuth = archive.tables
    .find((table) => table.name === 'auth.users')!
    .rows.map((raw) => JSON.parse(raw) as SourceMigrationIdentity);
  const nativeAuth = await db
    .collection<MigrationRecord>('auth_users')
    .find({}, { projection: { _id: 1, email: 1 } })
    .toArray();
  const targetHeaders = nativeAuth.map((row) => ({ id: row._id, email: String(row.email) }));
  const sourceHeaders = sourceAuth.map((row) => ({ id: row.id, email: row.email }));
  const approvedAliases: NonNullable<MigrationIdentitySnapshots['approvedAliases']> = [];
  for (const email of ['john@gmail.com', 'bartolo@gmail.com', 'paulo@gmail.com']) {
    const from = sourceHeaders.filter((row) => row.email === email),
      to = targetHeaders.filter((row) => row.email === email);
    if (from.length === 1 && to.length === 1 && from[0]!.id !== to[0]!.id)
      approvedAliases.push({
        sourceId: from[0]!.id,
        targetId: to[0]!.id,
        email,
        reason: 'owner-approved-test-account',
      });
  }
  const bindings: MigrationIdentityBinding[] = [];
  for (const identity of sourceAuth) {
    const staff = source['public.staff_users']!.find((row) => row.id === identity.id);
    const customer = source['public.customers']!.find((row) => row.auth_user_id === identity.id);
    if (staff)
      bindings.push({
        identityId: identity.id,
        email: String(staff.email),
        fullName: String(staff.full_name),
        kind: 'staff',
        mustChangePassword: staff.must_change_password === true,
      });
    else if (customer)
      bindings.push({
        identityId: identity.id,
        email: String(customer.email),
        fullName: [customer.first_name, customer.last_name].filter(Boolean).join(' '),
        kind: 'customer',
        mustChangePassword: null,
      });
  }
  const identityPlan = planMigrationIdentities(
    sourceAuth,
    bindings,
    targetHeaders,
    owner,
    approvedAliases,
  );
  const target: Record<string, MigrationRecord[]> = {};
  let nextTable = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (nextTable < tables.length) {
      const table = tables[nextTable++]!;
      target[table.target] = await db.collection<MigrationRecord>(table.target).find().toArray();
    }
  }));
  const identities: MigrationIdentitySnapshots = {
    source: sourceHeaders,
    target: [
      ...targetHeaders,
      ...identityPlan.users.map((row) => ({ id: String(row._id), email: String(row.email) })),
    ],
    approvedAliases,
  };
  const nonCanonicalTargetFields: {table:string;column:string;type:string}[] = [];
  const nonCanonical = (value: unknown): string | null => {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) return value.map(nonCanonical).find(Boolean) ?? null;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value.constructor?.name ?? 'unknown';
    return Object.values(value).map(nonCanonical).find(Boolean) ?? null;
  };
  for (const [name,rows] of Object.entries(target)) for (const row of rows) for (const [column,value] of Object.entries(row)) {
    const type = nonCanonical(value);
    if (type && !nonCanonicalTargetFields.some(issue => issue.table === name && issue.column === column && issue.type === type)) nonCanonicalTargetFields.push({ table:name,column,type });
  }
  const mapping = planMigrationMapping(
    {
      version: 1,
      timestampPrecision: 'preserve-source',
      protectedOwner: { table: 'public.staff_users', ...owner },
      tables,
    },
    { source, target, identities },
  );
  const countIssues = (issues: { code: string }[]) =>
    Object.fromEntries(
      [...new Set(issues.map((issue) => issue.code))].map((code) => [
        code,
        issues.filter((issue) => issue.code === code).length,
      ]),
    );
  const referenceDifferences: {table:string;columns:string[]}[] = [];
  const referenceReuseProposals: MigrationReferenceReuse[] = [];
  for (const table of tables.filter(table => table.referenceMatch)) {
    const changed = new Set<string>();
    for (const original of source[table.source] ?? []) {
      const row = { ...original };
      for (const [column,parent] of Object.entries(table.references ?? {})) row[column] = mapping.mapping.find(alias => alias.table === parent && alias.sourceId === row[column])?.targetId ?? row[column];
      for (const column of table.timestamps ?? []) if (row[column] != null) { const parsed = migrationTimestamp(row[column], 'preserve-source'); if ('value' in parsed) row[column] = parsed.value; }
      for (const [column, kind] of Object.entries(table.bigints ?? {})) if (kind === 'safe_integer' && typeof row[column] === 'string') row[column] = Number(row[column]);
      const native = target[table.target]!.find(candidate => table.referenceMatch!.every(column => candidate[table.renames?.[column] ?? column] === row[column]));
      if (native) {
        const differences = table.columns.filter(column => column !== 'id' && migrationFingerprint(row[column] ?? null) !== migrationFingerprint(native[table.renames?.[column] ?? column] ?? null));
        for (const column of differences) changed.add(column);
        const sourceId = migrationSourceRowKey(table, original);
        if (mapping.issues.some(issue => issue.table === table.source && issue.row === sourceId && issue.code === 'REFERENCE_RECORD_CONFLICT') && differences.every(column => migrationReferenceMetadataColumns[table.source]?.includes(column))) referenceReuseProposals.push({ table: table.source, sourceId, targetId: native._id, sourceFingerprint: migrationFingerprint(original), targetFingerprint: migrationFingerprint(native) });
      }
    }
    if (changed.size) referenceDifferences.push({ table:table.source,columns:[...changed].sort() });
  }
  const currentLedgerCounter = await db.collection<MigrationRecord>('counters').findOne({ _id: 'points-ledger' });
  if (typeof currentLedgerCounter?.seq === 'number' && !Number.isSafeInteger(currentLedgerCounter.seq)) throw new Error('Exact ledger counter evidence required');
  const existingLedgerSequence = currentLedgerCounter?.seq == null ? null : String(currentLedgerCounter.seq);
  const ledgerIdResolution = planMigrationLedgerIds(source['public.points_ledger']!, target.points_ledger!, existingLedgerSequence);
  const ledgerIdPlan = ledgerIdResolution.ready ? { existingSequence: existingLedgerSequence, digest: ledgerIdResolution.digest } : undefined;
  const metadataCandidate = planMigrationMapping({ version: 1, timestampPrecision: 'preserve-source', protectedOwner: { table: 'public.staff_users', ...owner }, tables }, { source, target, identities, referenceReuse: referenceReuseProposals, ...(ledgerIdPlan ? { ledgerIdPlan } : {}) });
  const pointsCapDifferences = source['public.tier_points_config']!.flatMap(row => {
    const native = target.tier_points_config!.find(item => item.tier === row.tier);
    return native && String(native.annual_points_cap) !== String(row.annual_points_cap) ? [{ tier: String(row.tier), sourceAnnualCap: String(row.annual_points_cap), nativeAnnualCap: String(native.annual_points_cap) }] : [];
  });
  const roleDepartmentDifferences = source['public.roles']!.flatMap(row => {
    const native = target.roles!.find(item => item.slug === row.slug);
    const mappedDepartment = mapping.mapping.find(alias => alias.table === 'public.departments' && alias.sourceId === row.department_id)?.targetId ?? row.department_id ?? null;
    if (!native || mappedDepartment === (native.department_id ?? null)) return [];
    return [{ role: String(row.slug), sourceDepartment: source['public.departments']!.find(item => item.id === row.department_id)?.code ?? null, nativeDepartment: target.departments!.find(item => item._id === native.department_id)?.code ?? null }];
  });
  const roleDepartmentFillProposals = source['public.roles']!.flatMap(row => {
    const native = target.roles!.find(item => item.slug === row.slug);
    const sourceDepartment = source['public.departments']!.find(item => item.id === row.department_id);
    const departments = target.departments!.filter(item => item.code === sourceDepartment?.code);
    if (!native || native.department_id != null || !sourceDepartment || departments.length > 1 || (departments.length === 1 && departments[0]!.is_active !== true) || (!departments.length && sourceDepartment.is_active !== true)) return [];
    const proposedDepartmentId = departments[0]?._id ?? mapping.mapping.find(alias => alias.table === 'public.departments' && alias.sourceId === sourceDepartment.id)?.targetId;
    if (!proposedDepartmentId) return [];
    return [{ roleId: native._id, role: String(row.slug), departmentCode: String(sourceDepartment.code), proposedDepartmentId, requiresDepartmentCreation: !departments.length, expectedCurrentRoleFingerprint: migrationFingerprint(native), onlyIfDepartmentMissing: true, existingGrantsAssignmentsAndAccountsChanged: false }];
  });
  const uniqueCollisionDetails: { table: string; sourceId: string; nativeId: string; columns: string[]; sameReviewedTestIdentity: boolean; sameName: boolean; sameBirthDate: boolean }[] = [];
  const nonemptyEqual = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && !!a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const issue of metadataCandidate.issues.filter(item => item.code === 'UNIQUE_CONFLICT')) {
    const table = tables.find(item => item.source === issue.table)!;
    const original = source[table.source]!.find(row => migrationSourceRowKey(table, row) === issue.row);
    if (!original) continue;
    const resolved = { ...original };
    for (const [column, parent] of Object.entries(table.references ?? {})) resolved[column] = mapping.mapping.find(alias => alias.table === parent && alias.sourceId === original[column])?.targetId ?? original[column];
    const constraints = [...(table.unique ?? []).map(columns => ({ columns, when: {} })), ...(table.partialUnique ?? [])];
    const matchesWhen = (row: Record<string, unknown>, when: Record<string, unknown>) => Object.entries(when).every(([column, value]) => Array.isArray(value) ? value.includes(row[column]) : row[column] === value);
    for (const constraint of constraints) for (const native of target[table.target]!) {
      if (!matchesWhen(resolved, constraint.when) || !matchesWhen(native, constraint.when) || constraint.columns.some(column => resolved[column] == null || migrationFingerprint(resolved[column]) !== migrationFingerprint(native[table.renames?.[column] ?? column] ?? null))) continue;
      uniqueCollisionDetails.push({ table: table.source, sourceId: issue.row!, nativeId: native._id, columns: constraint.columns, sameReviewedTestIdentity: approvedAliases.some(alias => nonemptyEqual(alias.email, original.email) && nonemptyEqual(alias.email, native.email)), sameName: nonemptyEqual(original.full_name ?? [original.first_name, original.last_name].filter(Boolean).join(' '), native.full_name ?? [native.first_name, native.last_name].filter(Boolean).join(' ')), sameBirthDate: nonemptyEqual(original.birth_date, native.birth_date) });
    }
  }
  return {
    reviewedAt: new Date().toISOString(),
    readOnly: true,
    sourceTables: tables.length,
    identitiesReady: identityPlan.ready,
    identityIssueCounts: countIssues(identityPlan.issues),
    approvedTestAliases: approvedAliases.length,
    newIdentityProposals: identityPlan.users.length,
    existingPasswordsProfilesRolesPreserved: true,
    ownerEmailsMatch:
      sourceHeaders.find((row) => row.id === owner.sourceId)?.email ===
      targetHeaders.find((row) => row.id === owner.targetId)?.email,
    mappingReady: mapping.ready,
    mappingIssueCounts: countIssues(mapping.issues),
    mappingIssues: mapping.issues,
    nonCanonicalTargetFields,
    referenceDifferences,
    metadataCandidate: { ready: metadataCandidate.ready, retainedNativeReferences: referenceReuseProposals.length, issueCounts: countIssues(metadataCandidate.issues), issues: metadataCandidate.issues, referenceReuseProposals, sourceReferenceEvidenceCollection: 'migration_source_reference_evidence', existingConfigurationChanged: false, sharedApply: false },
    policyDecisionsRequired: { pointsCapDifferences, roleDepartmentDifferences },
    roleDepartmentFillProposals,
    ledgerIdResolution,
    departmentSetupCandidate: planMigrationDepartmentSetup({ version: 1, timestampPrecision: 'preserve-source', protectedOwner: { table: 'public.staff_users', ...owner }, tables }, { source, target, identities, referenceReuse: referenceReuseProposals, ...(ledgerIdPlan ? { ledgerIdPlan } : {}) }),
    uniqueCollisionDetails,
    sourceDataImported: false,
    databaseWrites: false,
  };
}
