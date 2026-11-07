import { z } from 'zod';
import { migrationTimestamp } from './migration-mapping.js';
import { purchaseFingerprint } from './purchase-fingerprint.js';
import { tagMigrationPassword } from './migration-password.js';
import {
  auditStaffIdentityReferences,
  type MigrationIdentitySnapshots,
} from './migration-identity-references.js';

export type SourceMigrationIdentity = {
  id: string;
  email: string;
  encrypted_password: string;
  created_at: string;
  updated_at: string;
  email_confirmed_at: string | null;
  banned_until: string | null;
  deleted_at: string | null;
  is_anonymous: boolean;
  is_sso_user: boolean;
  providers: string[];
};
export type MigrationIdentityBinding = {
  identityId: string;
  email: string;
  fullName: string;
  kind: 'staff' | 'customer';
  mustChangePassword: boolean | null;
};
export function planMigrationIdentities(
  source: SourceMigrationIdentity[],
  bindings: MigrationIdentityBinding[],
  target: { id: string; email: string }[],
  owner: { sourceId: string; targetId: string },
  approvedAliases: NonNullable<MigrationIdentitySnapshots['approvedAliases']> = [],
) {
  const id = z.uuid().regex(/^[0-9a-f-]+$/);
  const sourceSchema = z.array(
    z
      .object({
        id,
        email: z.email(),
        encrypted_password: z.string(),
        created_at: z.string(),
        updated_at: z.string(),
        email_confirmed_at: z.string().nullable(),
        banned_until: z.string().nullable(),
        deleted_at: z.string().nullable(),
        is_anonymous: z.boolean(),
        is_sso_user: z.boolean(),
        providers: z.array(z.string()),
      })
      .strict(),
  );
  const bindingSchema = z.array(
    z
      .object({
        identityId: id,
        email: z.email(),
        fullName: z.string().min(1),
        kind: z.enum(['staff', 'customer']),
        mustChangePassword: z.boolean().nullable(),
      })
      .strict(),
  );
  const targetSchema = z.array(z.object({ id, email: z.email() }).strict());
  const issues: { row: string | null; code: string }[] = [];
  const issue = (row: string | null, code: string) => issues.push({ row, code });
  const users: (Record<string, unknown> & { _id: string })[] = [],
    accounts: (Record<string, unknown> & { _id: string })[] = [];
  const credentials = new Map<string, string>(),
    staffPasswordFlags: Record<string, boolean> = {};
  const finish = () => {
    const ready = issues.length === 0;
    const digest = purchaseFingerprint(
      ready
        ? {
            source: source.map((row) =>
              row.id === owner.sourceId ? { id: row.id, email: row.email } : row,
            ),
            bindings,
            target,
            owner,
            approvedAliases,
          }
        : { issues, owner },
    );
    const result = {
      ready,
      issues,
      users: ready ? users : [],
      accounts: ready ? accounts : [],
      staffPasswordFlags: ready ? staffPasswordFlags : {},
      preservedIdentities: ready
        ? approvedAliases.map((alias) => ({ sourceId: alias.sourceId, targetId: alias.targetId }))
        : [],
      digest,
    };
    return Object.defineProperty(result, 'credentials', {
      value: ready ? credentials : new Map<string, string>(),
      enumerable: false,
    }) as typeof result & { credentials: Map<string, string> };
  };
  if (
    !sourceSchema.safeParse(source).success ||
    !bindingSchema.safeParse(bindings).success ||
    !targetSchema.safeParse(target).success ||
    !z
      .array(
        z
          .object({
            sourceId: id,
            targetId: id,
            email: z.email(),
            reason: z.literal('owner-approved-test-account'),
          })
          .strict(),
      )
      .max(3)
      .safeParse(approvedAliases).success ||
    !id.safeParse(owner.sourceId).success ||
    !id.safeParse(owner.targetId).success
  ) {
    issue(null, 'INVALID_IDENTITY_PROJECTION');
    return finish();
  }
  const email = (value: string) => value.trim().toLowerCase();
  for (const rows of [source.map((row) => ({ id: row.id, email: row.email })), target]) {
    const ids = new Set<string>(),
      emails = new Set<string>();
    for (const row of rows) {
      if (ids.has(row.id) || emails.has(email(row.email))) issue(row.id, 'AMBIGUOUS_IDENTITY');
      ids.add(row.id);
      emails.add(email(row.email));
    }
  }
  const sourceOwner = source.find((row) => row.id === owner.sourceId),
    targetOwner = target.find((row) => row.id === owner.targetId);
  if (!sourceOwner || !targetOwner || email(sourceOwner.email) !== email(targetOwner.email))
    issue(null, 'OWNER_IDENTITY_MISMATCH');
  if (approvedAliases.length) {
    const snapshots = {
      source: source.map((row) => ({ id: row.id, email: row.email })),
      target,
      approvedAliases,
    };
    const selected = source
      .filter((row) => approvedAliases.some((alias) => alias.sourceId === row.id))
      .map((row) => ({ id: row.id, email: row.email }));
    for (const problem of auditStaffIdentityReferences(selected, owner, snapshots))
      issue(problem.row, problem.code);
  }
  for (const binding of bindings)
    if (!source.some((row) => row.id === binding.identityId))
      issue(binding.identityId, 'MISSING_SOURCE_IDENTITY');
    else if (bindings.filter((row) => row.identityId === binding.identityId).length !== 1)
      issue(binding.identityId, 'AMBIGUOUS_IDENTITY_PRINCIPAL');
  for (const row of source) {
    if (row.id === owner.sourceId) continue;
    const principals = bindings.filter((binding) => binding.identityId === row.id);
    if (principals.length !== 1) {
      issue(row.id, 'IDENTITY_PRINCIPAL_REQUIRED');
      continue;
    }
    const principal = principals[0]!;
    if (
      email(row.email) !== email(principal.email) ||
      (principal.kind === 'staff' && typeof principal.mustChangePassword !== 'boolean') ||
      (principal.kind === 'customer' && principal.mustChangePassword !== null)
    )
      issue(row.id, 'IDENTITY_PRINCIPAL_MISMATCH');
    if (approvedAliases.some((alias) => alias.sourceId === row.id)) {
      if (principal.kind !== 'staff') issue(row.id, 'TEST_HISTORY_ALIAS_REQUIRES_STAFF');
      continue;
    }
    if (
      target.some(
        (existing) => existing.id === row.id || email(existing.email) === email(row.email),
      )
    )
      issue(row.id, 'TARGET_IDENTITY_CONFLICT');
    if (
      row.is_anonymous ||
      row.is_sso_user ||
      row.banned_until !== null ||
      row.deleted_at !== null ||
      row.email_confirmed_at === null ||
      row.providers.length !== 1 ||
      row.providers[0] !== 'email'
    )
      issue(row.id, 'IDENTITY_STATE_REQUIRES_REVIEW');
    const timestamps: Date[] = [];
    for (const value of [row.created_at, row.updated_at, row.email_confirmed_at]) {
      // Auth uses BSON Date; retain exact source strings alongside the native millisecond fields.
      const parsed = migrationTimestamp(value, 'preserve-source');
      if ('error' in parsed) issue(row.id, 'INVALID_IDENTITY_TIMESTAMP');
      else timestamps.push(new Date(parsed.value));
    }
    try {
      credentials.set(row.id, tagMigrationPassword(row.encrypted_password));
    } catch {
      issue(row.id, 'UNSUPPORTED_IDENTITY_CREDENTIAL');
    }
    users.push({
      _id: row.id,
      email: email(row.email),
      name: principal.fullName,
      emailVerified: row.email_confirmed_at !== null,
      createdAt: timestamps[0],
      updatedAt: timestamps[1],
      migration_source_timestamps: {
        created_at: row.created_at,
        updated_at: row.updated_at,
        email_confirmed_at: row.email_confirmed_at,
      },
    });
    accounts.push({
      _id: 'migration-credential-' + purchaseFingerprint(row.id),
      accountId: row.id,
      userId: row.id,
      providerId: 'credential',
      createdAt: timestamps[0],
      updatedAt: timestamps[1],
    });
    if (principal.kind === 'staff')
      staffPasswordFlags[row.id] = principal.mustChangePassword as boolean;
  }
  return finish();
}
