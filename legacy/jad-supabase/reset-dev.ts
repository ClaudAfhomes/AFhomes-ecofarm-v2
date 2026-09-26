/**
 * Dev-only database reset for seed/sample cleanup (local/dev projects only).
 *
 * Context: `Member` rows own financial history through `ON DELETE RESTRICT`
 * FKs (`LedgerEntry`, `Commission`, `Wallet`, `Sale`, `Customer`,
 * `PayoutAccount` - see `supabase/migrations/20260916000001_delete_protection.sql`
 * and `AGENTS.md` "No hard member deletion"). Deleting members piecemeal is
 * therefore blocked BY DESIGN (archive via `POST /admin/members/:id/archive`
 * is the sanctioned lifecycle) and would orphan genealogy links, SET NULL
 * attributions, and `auth.users` logins. For full dev-seed cleanup, reset the
 * whole seed-managed graph instead of fighting the constraints.
 *
 * How it works: service-role REST (PostgREST) ordered DELETEs, leaf tables
 * first so every FK - including the RESTRICTs - stays enforced the whole
 * time. Constraints are never disabled, dropped, or altered. The run is
 * idempotent: re-running deletes whatever remains (0-row deletes succeed).
 *
 * Safety model (fail-closed):
 * - Default mode is DRY-RUN: SELECTs + auth lookups only, changes nothing.
 * - `--execute` is required to mutate, AND the target project ref must be
 *   listed in `DEV_RESET_ALLOW_REFS` (comma-separated). Anything else aborts.
 *   Never add a production/staging ref to that allowlist.
 * - Only the three seed auth accounts are ever removed
 *   (`admin@jad.local`, `user@jad.local`, `ramon.reyes@example.com`).
 * - Storage buckets/objects are left untouched.
 *
 * Usage:
 *   tsx supabase/reset-dev.ts                        # dry-run (default)
 *   tsx supabase/reset-dev.ts --verify               # orphan/consistency checks only
 *   DEV_RESET_ALLOW_REFS=vudwoqduebdgtzvybywb tsx supabase/reset-dev.ts --execute
 *   pnpm seed                                        # reseed afterwards
 */

import fs from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function loadEnvFile(path: string): void {
  try {
    const content = fs.readFileSync(path, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env) && value) process.env[key] = value;
    }
  } catch {
    // missing file - fall through to whatever the environment provides
  }
}

loadEnvFile('.env');

// Seed-managed tables in leaf-first delete order (dependents before the rows
// they reference, so RESTRICT FKs never fire). `column` is the PK used for
// the match-all delete filter.
const DELETE_ORDER: { table: string; column: string }[] = [
  { table: 'MemberRole', column: 'memberId' },
  { table: 'StaffAssignment', column: 'staffUserId' },
  { table: 'IdempotencyKey', column: 'key' },
  { table: 'LedgerEntry', column: 'id' },
  { table: 'Commission', column: 'id' },
  { table: 'Withdrawal', column: 'id' },
  { table: 'Voucher', column: 'id' },
  { table: 'VoucherTemplate', column: 'id' },
  { table: 'Adjustment', column: 'id' },
  { table: 'Wallet', column: 'memberId' },
  { table: 'Sale', column: 'id' },
  { table: 'Customer', column: 'id' },
  { table: 'PayoutAccount', column: 'id' },
  { table: 'Notification', column: 'id' },
  { table: 'ContentItem', column: 'id' },
  { table: 'Registration', column: 'id' },
  { table: 'Member', column: 'id' },
  { table: 'StaffUser', column: 'id' },
  { table: 'Role', column: 'id' },
  { table: 'ProgramQuestion', column: 'id' },
  { table: 'Program', column: 'id' },
  { table: 'Policy', column: 'id' },
  { table: 'SystemConfig', column: 'key' },
  { table: 'Property', column: 'id' },
  { table: 'PropertyCategory', column: 'slug' },
  { table: 'cms_contents', column: 'key' },
];

// Auth accounts created by the seed. Only these are ever deleted.
const SEED_AUTH_EMAILS = ['admin@jad.local', 'user@jad.local', 'ramon.reyes@example.com'] as const;

// Sentinel values no real row carries - match-all delete without disabling
// anything. UUID PK/FK columns get the nil UUID; text PKs get the string
// sentinel. Every column in DELETE_ORDER must be classified here: a text
// sentinel sent to a uuid column aborts the whole run (same defect that
// broke purge-seed-keep-core on StaffAssignment.staffUserId).
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const TEXT_SENTINEL = '__reset_dev_sentinel__';
const UUID_COLUMNS = new Set(['id', 'memberId', 'staffUserId', 'sellerId', 'member_id']);

function sentinelFor(column: string): string {
  return UUID_COLUMNS.has(column) ? NIL_UUID : TEXT_SENTINEL;
}

/** Project ref from a Supabase URL (`https://<ref>.supabase.co` → `<ref>`). */
export function projectRefFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.split('.')[0] ?? '';
  } catch {
    return '';
  }
}

function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env).');
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false } });
}

function isMissingTable(error: { code?: string; status?: number } | null): boolean {
  return error?.code === 'PGRST205' || error?.status === 404;
}

async function tableCount(
  supabase: SupabaseClient,
  table: string,
): Promise<{ exists: boolean; count: number }> {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) {
    if (
      isMissingTable({
        code: (error as { code?: string }).code,
        status: (error as { status?: number }).status,
      })
    ) {
      return { exists: false, count: 0 };
    }
    throw new Error(`count ${table} failed: ${error.message}`);
  }
  return { exists: true, count: count ?? 0 };
}

async function deleteAll(
  supabase: SupabaseClient,
  table: string,
  column: string,
): Promise<{ exists: boolean; deleted: number }> {
  const { count, error } = await supabase
    .from(table)
    .delete({ count: 'exact' })
    .neq(column, sentinelFor(column));
  if (error) {
    if (
      isMissingTable({
        code: (error as { code?: string }).code,
        status: (error as { status?: number }).status,
      })
    ) {
      return { exists: false, deleted: 0 };
    }
    throw new Error(
      `delete ${table} failed (constraints enforced - resolve manually, then re-run): ${error.message}`,
    );
  }
  return { exists: true, deleted: count ?? 0 };
}

async function seedAuthPresent(supabase: SupabaseClient): Promise<string[]> {
  const present: string[] = [];
  try {
    const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const email of SEED_AUTH_EMAILS) {
      if ((data?.users ?? []).some((u) => u.email?.toLowerCase() === email)) present.push(email);
    }
  } catch {
    // lookup failure → unknown; never delete on uncertainty (handled in execute)
    throw new Error('auth user lookup failed - aborting rather than guessing.');
  }
  return present;
}

async function deleteSeedAuth(
  supabase: SupabaseClient,
): Promise<{ deleted: string[]; missing: string[] }> {
  const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const deleted: string[] = [];
  const missing: string[] = [];
  for (const email of SEED_AUTH_EMAILS) {
    const user = (data?.users ?? []).find((u) => u.email?.toLowerCase() === email);
    if (!user) {
      missing.push(email);
      continue;
    }
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`deleteUser ${email} failed: ${error.message}`);
    deleted.push(email);
  }
  return { deleted, missing };
}

async function findOrphans(supabase: SupabaseClient): Promise<string[]> {
  // Member ids remaining (dev-scale sets).
  const { data: members, error: memberErr } = await supabase.from('Member').select('id');
  if (memberErr) {
    if (
      isMissingTable({
        code: (memberErr as { code?: string }).code,
        status: (memberErr as { status?: number }).status,
      })
    )
      return [];
    throw new Error(`orphan scan (Member) failed: ${memberErr.message}`);
  }
  const memberIds = new Set(((members ?? []) as { id: string }[]).map((m) => m.id));
  const orphans: string[] = [];
  const dependents: { table: string; idColumn: string; ownerColumn: string }[] = [
    { table: 'LedgerEntry', idColumn: 'id', ownerColumn: 'memberId' },
    { table: 'Commission', idColumn: 'id', ownerColumn: 'memberId' },
    { table: 'Sale', idColumn: 'id', ownerColumn: 'sellerId' },
    { table: 'Customer', idColumn: 'id', ownerColumn: 'memberId' },
    { table: 'Wallet', idColumn: 'memberId', ownerColumn: 'memberId' },
  ];
  for (const dep of dependents) {
    const { data, error } = await supabase
      .from(dep.table)
      .select(`${dep.idColumn}, ${dep.ownerColumn}`)
      .limit(5000);
    if (error) {
      if (
        isMissingTable({
          code: (error as { code?: string }).code,
          status: (error as { status?: number }).status,
        })
      )
        continue;
      throw new Error(`orphan scan (${dep.table}) failed: ${error.message}`);
    }
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const owner = row[dep.ownerColumn];
      if (typeof owner === 'string' && !memberIds.has(owner)) {
        orphans.push(`${dep.table} id=${String(row[dep.idColumn])}`);
      }
    }
  }
  return orphans;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const mode = args.has('--execute') ? 'execute' : args.has('--verify') ? 'verify' : 'dry-run';

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  const ref = projectRefFromUrl(supabaseUrl);
  if (!ref || ref.includes('your-project')) {
    console.error('Could not resolve a Supabase project ref. Aborting.');
    process.exit(1);
  }
  const allowed = (process.env.DEV_RESET_ALLOW_REFS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Target project ref: ${ref}`);
  console.log(`Mode: ${mode}`);

  const supabase = serviceClient();

  if (mode === 'verify') {
    const orphans = await findOrphans(supabase);
    const seedAccounts = await seedAuthPresent(supabase);
    console.log(`Orphaned member-linked rows: ${orphans.length}`);
    for (const o of orphans.slice(0, 20)) console.log(`  orphan ${o}`);
    console.log(`Seed auth accounts present: ${seedAccounts.join(', ') || '(none)'}`);
    if (orphans.length > 0) process.exit(2);
    return;
  }

  const counts: { table: string; exists: boolean; count: number }[] = [];
  for (const t of DELETE_ORDER) {
    counts.push({ table: t.table, ...(await tableCount(supabase, t.table)) });
  }
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const present = counts.filter((c) => c.exists).length;
  console.log(`Seed tables present: ${present}/${DELETE_ORDER.length} (${total} rows total)`);
  for (const c of counts.filter((c) => c.count > 0)) console.log(`  ${c.table}: ${c.count}`);
  const seedAccounts = await seedAuthPresent(supabase);
  console.log(`Seed auth accounts present: ${seedAccounts.join(', ') || '(none)'}`);

  if (mode === 'dry-run') {
    console.log(
      `\nDRY-RUN - no changes made. Re-run with --execute plus DEV_RESET_ALLOW_REFS=${ref} to delete these rows and the seed auth accounts, then run \`pnpm seed\`.`,
    );
    return;
  }

  if (!allowed.includes(ref)) {
    console.error(
      `Refusing: project ref "${ref}" is not listed in DEV_RESET_ALLOW_REFS. ` +
        `This script only runs against explicitly allowlisted LOCAL/DEV projects - never production. Aborting with no changes.`,
    );
    process.exit(1);
  }

  // --execute (guard passed): leaf-first deletes, every FK enforced.
  // Idempotent - re-running deletes whatever remains.
  let deletedTotal = 0;
  for (const t of DELETE_ORDER) {
    const { exists, deleted } = await deleteAll(supabase, t.table, t.column);
    if (exists && deleted > 0) console.log(`  deleted ${deleted} from ${t.table}`);
    deletedTotal += deleted;
  }
  console.log(
    `\nDeleted ${deletedTotal} rows across ${DELETE_ORDER.length} tables (constraints enforced).`,
  );

  const { deleted, missing } = await deleteSeedAuth(supabase);
  console.log(`Deleted seed auth accounts: ${deleted.join(', ') || '(none found)'}`);
  if (missing.length > 0) console.log(`Already absent: ${missing.join(', ')}`);

  const orphans = await findOrphans(supabase);
  const remaining = await seedAuthPresent(supabase);
  console.log(
    `Post-reset orphans: ${orphans.length}; seed auth accounts remaining: ${remaining.join(', ') || '(none)'}`,
  );
  if (orphans.length > 0 || remaining.length > 0) {
    for (const o of orphans.slice(0, 20)) console.log(`  orphan ${o}`);
    console.error('Verification FAILED - inspect output above.');
    process.exit(2);
  }
  console.log(
    '\nVerification PASSED. Next steps: `pnpm seed`, then run `supabase/security/rls_invariants.sql` (empty = PASS).',
  );
}

void main().catch((err: unknown) => {
  console.error('reset-dev failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
