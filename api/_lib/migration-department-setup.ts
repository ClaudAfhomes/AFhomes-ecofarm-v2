import { planMigrationMapping, migrationSourceRowKey, type MigrationManifest, type MigrationRecord, type MigrationReferenceReuse } from './migration-mapping.js';
import { migrationFingerprint } from './migration-fingerprint.js';

/** Local candidate only: fill missing source-backed links, never overwrite native role configuration. */
export function planMigrationDepartmentSetup(manifest: MigrationManifest, input: Parameters<typeof planMigrationMapping>[1]) {
  const issues: { code: string; role?: string }[] = [];
  const staff = manifest.tables.find(table => table.source === manifest.protectedOwner.table);
  const departments = manifest.tables.find(table => table.source === 'public.departments');
  const finish = () => ({ setupReady: false, issues, newDepartments: [] as MigrationRecord[], roleFills: [] as { roleId: string; departmentId: string; expectedFingerprint: string }[], candidateReady: false, candidateIssues: issues, referenceReuseCount: 0, candidateDigest: '', databaseWrites: false });
  const baseline = planMigrationMapping(manifest, input);
  if (baseline.issues.some(issue => !['REFERENCE_RECORD_CONFLICT', 'UNIQUE_CONFLICT', 'TARGET_RECORD_CONFLICT'].includes(issue.code))) {
    issues.push({ code: 'SOURCE_OR_TARGET_VALIDATION_REQUIRED' }, ...baseline.issues);
    return finish();
  }
  if (!staff || !departments || !input.source['public.roles'] || !input.target.roles) { issues.push({ code: 'DEPARTMENT_SETUP_INPUT_REQUIRED' }); return finish(); }
  const partial = planMigrationMapping({ ...manifest, tables: [staff, departments] }, {
    source: { [staff.source]: input.source[staff.source]!.filter(row => row.id === manifest.protectedOwner.sourceId), [departments.source]: input.source[departments.source]! },
    target: { [staff.target]: input.target[staff.target]!, [departments.target]: input.target[departments.target]! },
    ...(input.identities ? { identities: input.identities } : {}),
    ...(input.referenceReuse ? { referenceReuse: input.referenceReuse.filter(item => item.table === departments.source) } : {}),
  });
  if (!partial.ready) { issues.push({ code: 'DEPARTMENT_REFERENCE_PLAN_BLOCKED' }, ...partial.issues); return finish(); }
  const target = structuredClone(input.target);
  const newDepartments = partial.records.departments!;
  target.departments!.push(...newDepartments);
  const roleFills: { roleId: string; departmentId: string; expectedFingerprint: string }[] = [];
  for (const sourceRole of input.source['public.roles']!) {
    if (sourceRole.department_id == null) continue;
    const matches = target.roles!.filter(row => row.slug === sourceRole.slug);
    if (!matches.length) continue;
    const originalDepartment = input.source['public.departments']!.find(row => row.id === sourceRole.department_id);
    const matchesDepartment = target.departments!.filter(row => row.code === originalDepartment?.code && row.is_active === true);
    if (matches.length !== 1 || !originalDepartment || matchesDepartment.length !== 1) { issues.push({ code: 'AMBIGUOUS_OR_INACTIVE_ROLE_DEPARTMENT', role: String(sourceRole.slug) }); continue; }
    const role = matches[0]!, department = matchesDepartment[0]!;
    if (role.department_id != null) {
      if (role.department_id !== department._id) issues.push({ code: 'EXISTING_ROLE_DEPARTMENT_PRESERVED', role: String(sourceRole.slug) });
      continue;
    }
    roleFills.push({ roleId: role._id, departmentId: department._id, expectedFingerprint: migrationFingerprint(role) });
    role.department_id = department._id;
  }
  if (issues.length) return finish();
  const intermediate = planMigrationMapping(manifest, { ...input, target });
  const reuse: MigrationReferenceReuse[] = [...(input.referenceReuse ?? [])];
  for (const issue of intermediate.issues.filter(item => item.table === 'public.roles' && item.code === 'REFERENCE_RECORD_CONFLICT')) {
    const definition = manifest.tables.find(table => table.source === issue.table)!;
    const original = input.source[issue.table]!.find(row => migrationSourceRowKey(definition, row) === issue.row)!;
    const native = target.roles!.find(row => row.slug === original.slug)!;
    if (!reuse.some(item => item.table === issue.table && item.sourceId === issue.row)) reuse.push({ table: issue.table, sourceId: issue.row!, targetId: native._id, sourceFingerprint: migrationFingerprint(original), targetFingerprint: migrationFingerprint(native) });
  }
  const candidate = planMigrationMapping(manifest, { ...input, target, referenceReuse: reuse });
  return { setupReady: true, issues, newDepartments, roleFills, candidateReady: candidate.ready, candidateIssues: candidate.issues, referenceReuseCount: reuse.length, candidateDigest: candidate.digest, databaseWrites: false };
}
