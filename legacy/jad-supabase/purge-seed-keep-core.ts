/**
 * Seed-data purge that preserves ONLY the production core (Phase B).
 *
 * Preserves (never touched):
 *   - `cms_contents` - Website CMS (8 keys: homepage, about, properties,
 *                           faqs, contact, global, login, register)
 *   - `SystemConfig` - System Configuration (9 CONFIG_SEEDS keys)
 *
 * Deletes (leaf-first, every FK enforced the whole time):
 *   - All member/staff/transactional/reference rows (see PURGE_ORDER)
 *   - `Role` catalog (rebuilt by `provision-superadmin.ts` before login works)
 *   - `AuditLog` seed-era rows (owner-approved BI-005 exception for the seed
 *     reset; pass `--keep-audit-log` to retain instead)
 *   - Auth users via `auth.admin.deleteUser`, EXCEPT addresses in
 *     `PURGE_KEEP_AUTH_EMAILS` (comma-separated, case-insensitive). Default is
 *     empty = delete all listed users (fresh slate for the prod super-admin).
 *
 * Constraints are never disabled, dropped, or altered. Storage
 * buckets/objects are left untouched.
 *
 * Safety model (fail-closed, same as reset-dev.ts):
 * - Default mode is DRY-RUN: SELECTs + auth lookups only, changes nothing.
 * - `--execute` is required to mutate, AND the target project ref must be
 *   listed in `DEV_RESET_ALLOW_REFS` (comma-separated). Anything else aborts.
 *   Never add a production ref here until the cutover is approved.
 * - Post-execute verification asserts `cms_contents` (8) and `SystemConfig`
 *   (9) are untouched; any deviation aborts with a non-zero exit.
 *
 * Usage:
 *   pnpm exec tsx supabase/purge-seed-keep-core.ts                                    # dry-run
 *   pnpm exec tsx supabase/purge-seed-keep-core.ts --verify                          # orphan/count checks only
 *   DEV_RESET_ALLOW_REFS=<ref> pnpm exec tsx supabase/purge-seed-keep-core.ts --execute
 *   PURGE_KEEP_AUTH_EMAILS=new.admin@example.com DEV_RESET_ALLOW_REFS=<ref> pnpm exec tsx supabase/purge-seed-keep-core.ts --execute
 *   pnpm exec tsx supabase/purge-seed-keep-core.ts --execute --keep-audit-log       # retain AuditLog
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
// the match-all delete filter. `cms_contents` + `SystemConfig` are
// deliberately ABSENT (preserved core). `AuditLog` is last - it references
// nothing and nothing references it (actor FKs were split to StaffUser with
// SET NULL), so deleting it cannot orphan anything.
const PURGE_ORDER: { table: string; column: string }[] = [
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
  { table: 'Property', column: 'id' },
  { table: 'PropertyCategory', column: 'slug' },
  { table: 'AuditLog', column: 'id' },
];

// Preserved core - asserted non-empty and unchanged after --execute.
const PRESERVED: { table: string; column: string; expected: number }[] = [
  { table: 'cms_contents', column: 'key', expected: 8 },
  { table: 'SystemConfig', column: 'key', expected: 9 },
];

// Sentinel values no real row carries - match-all delete without disabling
// anything. UUID PK/FK columns get the nil UUID; text PKs get the string
// sentinel. Every column in PURGE_ORDER must be classified here: a text
// sentinel sent to a uuid column aborts the whole run (Postgres rejects the
// comparison), which is exactly how the first execute attempt failed on
// StaffAssignment.staffUserId.
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const TEXT_SENTINEL = '__purge_seed_keep_core_sentinel__';
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

function keepAuthEmails(): Set<string> {
  return new Set(
    (process.env.PURGE_KEEP_AUTH_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function listAuthEmails(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error)
    throw new Error(`auth user lookup failed - aborting rather than guessing: ${error.message}`);
  return (data?.users ?? []).map((u) => u.email ?? '(no email)');
}

async function deleteAuthExcept(
  supabase: SupabaseClient,
  keep: Set<string>,
): Promise<{ deleted: string[]; kept: string[] }> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error)
    throw new Error(`auth user lookup failed - aborting rather than guessing: ${error.message}`);
  const deleted: string[] = [];
  const kept: string[] = [];
  for (const user of data?.users ?? []) {
    const email = user.email ?? '';
    if (keep.has(email.toLowerCase())) {
      kept.push(email || '(no email)');
      continue;
    }
    const { error: delError } = await supabase.auth.admin.deleteUser(user.id);
    if (delError) throw new Error(`deleteUser ${email || user.id} failed: ${delError.message}`);
    deleted.push(email || user.id);
  }
  return { deleted, kept };
}

async function findOrphans(supabase: SupabaseClient): Promise<string[]> {
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
  const keepAuditLog = args.has('--keep-audit-log');

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
  const keep = keepAuthEmails();

  console.log(`Target project ref: ${ref}`);
  console.log(`Mode: ${mode}${keepAuditLog ? ' (AuditLog retained)' : ''}`);
  console.log(
    `Preserved core (never deleted): ${PRESERVED.map((p) => `${p.table} (~${p.expected})`).join(', ')}`,
  );

  const supabase = serviceClient();
  const purgeOrder = keepAuditLog ? PURGE_ORDER.filter((t) => t.table !== 'AuditLog') : PURGE_ORDER;

  if (mode === 'verify') {
    const orphans = await findOrphans(supabase);
    const authEmails = await listAuthEmails(supabase);
    for (const p of PRESERVED) {
      const { exists, count } = await tableCount(supabase, p.table);
      console.log(`Preserved ${p.table}: ${exists ? count : '(missing table)'}`);
    }
    console.log(`Orphaned member-linked rows: ${orphans.length}`);
    for (const o of orphans.slice(0, 20)) console.log(`  orphan ${o}`);
    console.log(`Auth users (${authEmails.length}): ${authEmails.join(', ') || '(none)'}`);
    if (orphans.length > 0) process.exit(2);
    return;
  }

  const counts: { table: string; exists: boolean; count: number }[] = [];
  for (const t of purgeOrder) {
    counts.push({ table: t.table, ...(await tableCount(supabase, t.table)) });
  }
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const present = counts.filter((c) => c.exists).length;
  console.log(`Purge tables present: ${present}/${purgeOrder.length} (${total} rows to delete)`);
  for (const c of counts.filter((c) => c.count > 0)) console.log(`  ${c.table}: ${c.count}`);
  const authEmails = await listAuthEmails(supabase);
  const doomed = authEmails.filter((e) => !keep.has(e.toLowerCase()));
  console.log(`Auth users to delete (${doomed.length}): ${doomed.join(', ') || '(none)'}`);
  if (keep.size > 0) {
    console.log(
      `Auth users kept via PURGE_KEEP_AUTH_EMAILS: ${[...keep].filter((e) => authEmails.map((a) => a.toLowerCase()).includes(e)).join(', ') || '(none matched)'}`,
    );
  }
  for (const p of PRESERVED) {
    const { exists, count } = await tableCount(supabase, p.table);
    console.log(`Preserved ${p.table}: ${exists ? count : '(missing table)'}`);
  }

  if (mode === 'dry-run') {
    console.log(
      `\nDRY-RUN - no changes made. Re-run with --execute plus DEV_RESET_ALLOW_REFS=${ref} to purge. ` +
        `Afterwards run \`provision-superadmin.ts\` to rebuild roles + the prod super-admin.`,
    );
    return;
  }

  if (!allowed.includes(ref)) {
    console.error(
      `Refusing: project ref "${ref}" is not listed in DEV_RESET_ALLOW_REFS. ` +
        `This script only runs against explicitly allowlisted LOCAL/DEV projects - never production without approval. Aborting with no changes.`,
    );
    process.exit(1);
  }

  // --execute (guard passed): leaf-first deletes, every FK enforced.
  let deletedTotal = 0;
  for (const t of purgeOrder) {
    const { exists, deleted } = await deleteAll(supabase, t.table, t.column);
    if (exists && deleted > 0) console.log(`  deleted ${deleted} from ${t.table}`);
    deletedTotal += deleted;
  }
  console.log(
    `\nDeleted ${deletedTotal} rows across ${purgeOrder.length} tables (constraints enforced).`,
  );

  const { deleted, kept } = await deleteAuthExcept(supabase, keep);
  console.log(`Deleted auth users: ${deleted.join(', ') || '(none found)'}`);
  if (kept.length > 0) console.log(`Kept auth users: ${kept.join(', ')}`);

  // Post-execute verification: preserved core untouched.
  let coreOk = true;
  for (const p of PRESERVED) {
    const { exists, count } = await tableCount(supabase, p.table);
    const ok = exists && count === p.expected;
    console.log(
      `Preserved ${p.table}: ${exists ? count : '(missing!)'} (expected ${p.expected}) ${ok ? 'OK' : 'MISMATCH'}`,
    );
    if (!ok) coreOk = false;
  }
  const orphans = await findOrphans(supabase);
  console.log(`Post-purge orphans: ${orphans.length}`);
  for (const o of orphans.slice(0, 20)) console.log(`  orphan ${o}`);
  if (orphans.length > 0 || !coreOk) {
    console.error('Verification FAILED - inspect output above before provisioning.');
    process.exit(2);
  }
  console.log(
    '\nVerification PASSED. Next: provision roles + prod super-admin via `supabase/provision-superadmin.ts`, then run `supabase/security/rls_invariants.sql` (empty = PASS).',
  );
}

void main().catch((err: unknown) => {
  console.error('purge-seed-keep-core failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
