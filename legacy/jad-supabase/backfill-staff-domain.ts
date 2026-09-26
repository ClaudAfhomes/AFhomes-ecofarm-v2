/**
 * Phase 2 - Staff domain backfill (Member/Staff separation).
 *
 * Creates one StaffUser per Member holding a staff-slug link, keyed by the
 * staffer's auth.users id (keeps one login identity per staffer, so session
 * matching and own-row RLS keep working). Staffers with no auth account are
 * reported and skipped - never invented. Creates one StaffAssignment per
 * staff-slug link, and remaps historical staff attributions
 * (AuditLog.actor_id, Registration.reviewedBy, Member.archivedBy,
 * cms_contents.updated_by, SystemConfig.updated_by) from staffer member
 * uuids to staff uuids.
 *
 * Phase 5 retirement (`--retire`): after the actor-FK migration
 * (20260929000001) is applied, deletes staffer MemberRole links and staffer
 * Member rows. Pre-verified every run: zero staffer-owned financial/graph
 * rows, zero members sponsored by staffers, zero staffer idempotency rows.
 * Notification inbox rows of retired staffers go with them (CASCADE).
 *
 * Safety model (fail-closed):
 * - Default mode is DRY-RUN: SELECTs only, changes nothing.
 * - `--execute` / `--retire` additionally require the target project ref in
 *   DEV_RESET_ALLOW_REFS (same guard as reset-dev.ts). Anything else aborts.
 * - Idempotent: existing StaffUser rows (matched by email) are reused,
 *   assignments upserted, attributions only rewritten while they still point
 *   at member uuids. Re-running converges.
 * - `--execute` writes a rollback map to backfill-staff-domain.map.json
 *   (created ids + original attribution values); `--rollback` consumes it to
 *   restore attributions, delete assignments/staff rows, and removes the map.
 * - `--retire` snapshots deleted Member rows, links, and notifications to
 *   backfill-staff-domain.retire.json first; `--retire-rollback` restores
 *   them. Financial tables are never touched.
 *
 * Usage:
 *   tsx supabase/backfill-staff-domain.ts                       # dry-run
 *   DEV_RESET_ALLOW_REFS=<ref> tsx supabase/backfill-staff-domain.ts --execute
 *   DEV_RESET_ALLOW_REFS=<ref> tsx supabase/backfill-staff-domain.ts --rollback
 *   DEV_RESET_ALLOW_REFS=<ref> tsx supabase/backfill-staff-domain.ts --retire
 *   DEV_RESET_ALLOW_REFS=<ref> tsx supabase/backfill-staff-domain.ts --retire-rollback
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function loadEnvFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
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

const MAP_PATH = path.resolve('supabase/backfill-staff-domain.map.json');
const RETIRE_PATH = path.resolve('supabase/backfill-staff-domain.retire.json');
const STAFF_SLUGS = ['super_admin', 'admin', 'finance', 'merchant'];

// Tables that must hold ZERO staffer-owned rows before member retirement
// (re-verified live on every --retire run; aborts otherwise).
const RETIRE_FINANCIAL_CHECKS: { table: string; column: string; idCol: string }[] = [
  { table: 'Wallet', column: 'memberId', idCol: 'memberId' },
  { table: 'LedgerEntry', column: 'memberId', idCol: 'id' },
  { table: 'Commission', column: 'memberId', idCol: 'id' },
  { table: 'Sale', column: 'sellerId', idCol: 'id' },
  { table: 'Customer', column: 'memberId', idCol: 'id' },
  { table: 'Voucher', column: 'memberId', idCol: 'id' },
  { table: 'Withdrawal', column: 'memberId', idCol: 'id' },
  { table: 'PayoutAccount', column: 'memberId', idCol: 'id' },
  { table: 'Adjustment', column: 'memberId', idCol: 'id' },
];

type RetireSnapshot = {
  members: Record<string, unknown>[];
  links: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
};

const ATTRIBUTIONS: { table: string; idColumn: string; actorColumn: string }[] = [
  { table: 'AuditLog', idColumn: 'id', actorColumn: 'actor_id' },
  { table: 'Registration', idColumn: 'id', actorColumn: 'reviewedBy' },
  { table: 'Member', idColumn: 'id', actorColumn: 'archivedBy' },
  { table: 'SystemConfig', idColumn: 'key', actorColumn: 'updated_by' },
  { table: 'cms_contents', idColumn: 'key', actorColumn: 'updated_by' },
];

type RollbackMap = {
  staffUsers: { id: string; email: string }[];
  attributions: { table: string; idColumn: string; id: string; column: string; before: string }[];
};

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

type Staffer = {
  memberId: string;
  /** Auth user id - StaffUser.id keys off this (never the member uuid). Null when the staffer has no login identity. */
  authId: string | null;
  email: string;
  name: string;
  accountStatus: string;
  slugs: string[];
  roleIds: string[];
};

async function authIdByEmail(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`auth user lookup failed: ${error.message}`);
  const map = new Map<string, string>();
  for (const u of data?.users ?? []) {
    if (u.email) map.set(u.email.toLowerCase(), u.id);
  }
  return map;
}

async function loadStaffers(supabase: SupabaseClient): Promise<Staffer[]> {
  const { data: roles, error: roleErr } = await supabase.from('Role').select('id,slug');
  if (roleErr) throw new Error(`Role read failed: ${roleErr.message}`);
  const slugByRoleId = new Map(
    ((roles ?? []) as { id: string; slug: string }[]).map((r) => [r.id, r.slug]),
  );
  const { data: links, error: linkErr } = await supabase
    .from('MemberRole')
    .select('memberId,roleId');
  if (linkErr) throw new Error(`MemberRole read failed: ${linkErr.message}`);
  const { data: members, error: memberErr } = await supabase
    .from('Member')
    .select('id,email,name,firstName,lastName,accountStatus');
  if (memberErr) throw new Error(`Member read failed: ${memberErr.message}`);
  const memberById = new Map(
    ((members ?? []) as Record<string, unknown>[]).map((m) => [m.id as string, m]),
  );
  const authIds = await authIdByEmail(supabase);
  const byMember = new Map<string, Staffer>();
  for (const l of (links ?? []) as { memberId: string; roleId: string }[]) {
    const slug = slugByRoleId.get(l.roleId) ?? '';
    if (!STAFF_SLUGS.includes(slug)) continue;
    let s = byMember.get(l.memberId);
    if (!s) {
      const m = (memberById.get(l.memberId) ?? {}) as Record<string, unknown>;
      const displayName =
        (m.name as string | undefined) ??
        ([m.firstName, m.lastName].filter(Boolean).join(' ') || '?');
      const email = (m.email as string | undefined) ?? '?';
      s = {
        memberId: l.memberId,
        authId: authIds.get(email.toLowerCase()) ?? null,
        email,
        name: displayName,
        accountStatus: String(m.accountStatus ?? ''),
        slugs: [],
        roleIds: [],
      };
      byMember.set(l.memberId, s);
    }
    if (!s.slugs.includes(slug)) s.slugs.push(slug);
    if (!s.roleIds.includes(l.roleId)) s.roleIds.push(l.roleId);
  }
  return [...byMember.values()];
}

function staffStatusFor(accountStatus: string): string {
  return accountStatus === 'ACTIVE' ? 'ACTIVE' : 'DISABLED';
}

async function stafferMemberIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data: roles } = await supabase.from('Role').select('id,slug');
  const slugByRoleId = new Map(
    ((roles ?? []) as { id: string; slug: string }[]).map((r) => [r.id, r.slug]),
  );
  const { data: links } = await supabase.from('MemberRole').select('memberId,roleId');
  const ids = new Set<string>();
  for (const l of (links ?? []) as { memberId: string; roleId: string }[]) {
    if (STAFF_SLUGS.includes(slugByRoleId.get(l.roleId) ?? '')) ids.add(l.memberId);
  }
  return ids;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const mode = args.has('--execute')
    ? 'execute'
    : args.has('--rollback')
      ? 'rollback'
      : args.has('--retire')
        ? 'retire'
        : args.has('--retire-rollback')
          ? 'retire-rollback'
          : 'dry-run';

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  const ref = projectRefFromUrl(supabaseUrl);
  if (!ref || ref.includes('your-project')) {
    console.error('Could not resolve a Supabase project ref. Aborting.');
    process.exit(1);
  }
  console.log(`Target project ref: ${ref}`);
  console.log(`Mode: ${mode}`);

  const supabase = serviceClient();

  if (mode === 'rollback') {
    if (!fs.existsSync(MAP_PATH)) {
      console.error(`No rollback map at ${MAP_PATH} - nothing to undo. Aborting.`);
      process.exit(1);
    }
    if (!allowed(ref)) process.exit(1);
    const map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')) as RollbackMap;
    for (const a of map.attributions) {
      const { error } = await supabase
        .from(a.table)
        .update({ [a.column]: a.before })
        .eq(a.idColumn, a.id);
      if (error) throw new Error(`rollback ${a.table} ${a.id} failed: ${error.message}`);
    }
    console.log(`Restored ${map.attributions.length} attribution values.`);
    for (const s of map.staffUsers) {
      const { error: assignErr } = await supabase
        .from('StaffAssignment')
        .delete()
        .eq('staffUserId', s.id);
      if (assignErr)
        throw new Error(`rollback assignments ${s.email} failed: ${assignErr.message}`);
      const { error: userErr } = await supabase.from('StaffUser').delete().eq('id', s.id);
      if (userErr) throw new Error(`rollback staff user ${s.email} failed: ${userErr.message}`);
    }
    console.log(`Removed ${map.staffUsers.length} staff users (+ assignments).`);
    fs.unlinkSync(MAP_PATH);
    console.log('Rollback complete; map file removed.');
    return;
  }

  if (mode === 'retire-rollback') {
    if (!fs.existsSync(RETIRE_PATH)) {
      console.error(`No retire snapshot at ${RETIRE_PATH} - nothing to undo. Aborting.`);
      process.exit(1);
    }
    if (!allowed(ref)) process.exit(1);
    const snap = JSON.parse(fs.readFileSync(RETIRE_PATH, 'utf8')) as RetireSnapshot;
    for (const row of snap.members) {
      const { error } = await supabase.from('Member').upsert(row as never, { onConflict: 'id' });
      if (error) throw new Error(`retire-rollback Member restore failed: ${error.message}`);
    }
    for (const row of snap.links) {
      const { error } = await supabase
        .from('MemberRole')
        .upsert(row as never, { onConflict: 'memberId,roleId' });
      if (error) throw new Error(`retire-rollback MemberRole restore failed: ${error.message}`);
    }
    for (const row of snap.notifications) {
      const { error } = await supabase
        .from('Notification')
        .upsert(row as never, { onConflict: 'id' });
      if (error) throw new Error(`retire-rollback Notification restore failed: ${error.message}`);
    }
    console.log(
      `Restored ${snap.members.length} members, ${snap.links.length} links, ${snap.notifications.length} notifications.`,
    );
    fs.unlinkSync(RETIRE_PATH);
    console.log('Retire rollback complete; snapshot removed.');
    return;
  }

  if (mode === 'retire') {
    if (!allowed(ref)) process.exit(1);
    const ids = [...(await stafferMemberIds(supabase))];
    if (ids.length === 0) {
      console.log('No staffer Member rows found - nothing to retire.');
      return;
    }
    // Pre-verification: financial/graph ownership must be zero, no members
    // sponsored by staffers, no staffer idempotency rows. Anything found
    // aborts BEFORE any write.
    for (const f of RETIRE_FINANCIAL_CHECKS) {
      const { data, error } = await supabase
        .from(f.table)
        .select(`${f.idCol}`)
        .in(f.column, ids)
        .limit(5);
      if (error) throw new Error(`retire pre-check ${f.table} failed: ${error.message}`);
      if ((data ?? []).length > 0) {
        console.error(
          `Refusing: ${f.table} still holds staffer-owned rows. Resolve manually and re-run. Aborting with no changes.`,
        );
        process.exit(2);
      }
    }
    const { data: sponsored, error: sponsErr } = await supabase
      .from('Member')
      .select('id')
      .in('sponsorId', ids)
      .limit(5);
    if (sponsErr) throw new Error(`retire pre-check sponsors failed: ${sponsErr.message}`);
    if ((sponsored ?? []).length > 0) {
      console.error(
        'Refusing: members are still sponsored by retiring staffers. Aborting with no changes.',
      );
      process.exit(2);
    }
    const { data: idem, error: idemErr } = await supabase
      .from('IdempotencyKey')
      .select('key')
      .in('memberId', ids)
      .limit(5);
    if (idemErr) throw new Error(`retire pre-check idempotency failed: ${idemErr.message}`);
    if ((idem ?? []).length > 0) {
      console.error('Refusing: staffer idempotency rows exist. Aborting with no changes.');
      process.exit(2);
    }
    console.log(`Pre-checks passed for ${ids.length} staffer Member rows.`);
    // Snapshot (for --retire-rollback), then delete links before members.
    const snap: RetireSnapshot = { members: [], links: [], notifications: [] };
    const { data: memberRows, error: memberErr } = await supabase
      .from('Member')
      .select('*')
      .in('id', ids);
    if (memberErr) throw new Error(`retire snapshot members failed: ${memberErr.message}`);
    snap.members = (memberRows ?? []) as unknown as Record<string, unknown>[];
    const { data: linkRows, error: linkErr } = await supabase
      .from('MemberRole')
      .select('*')
      .in('memberId', ids);
    if (linkErr) throw new Error(`retire snapshot links failed: ${linkErr.message}`);
    snap.links = (linkRows ?? []) as unknown as Record<string, unknown>[];
    const { data: notifRows, error: notifErr } = await supabase
      .from('Notification')
      .select('*')
      .in('member_id', ids);
    if (notifErr) throw new Error(`retire snapshot notifications failed: ${notifErr.message}`);
    snap.notifications = (notifRows ?? []) as unknown as Record<string, unknown>[];
    fs.writeFileSync(RETIRE_PATH, JSON.stringify(snap, null, 2));
    console.log(
      `Snapshot written (${snap.members.length} members, ${snap.links.length} links, ${snap.notifications.length} notifications; inbox rows go with CASCADE).`,
    );
    const { error: linkDelErr } = await supabase.from('MemberRole').delete().in('memberId', ids);
    if (linkDelErr) throw new Error(`retire delete links failed: ${linkDelErr.message}`);
    const { error: memberDelErr } = await supabase.from('Member').delete().in('id', ids);
    if (memberDelErr) throw new Error(`retire delete members failed: ${memberDelErr.message}`);
    const { data: remaining } = await supabase.from('Member').select('id').in('id', ids);
    if ((remaining ?? []).length > 0) {
      console.error('Verification FAILED: staffer Member rows remain.');
      process.exit(2);
    }
    console.log(`Retired ${ids.length} staffer Member rows (+ links). Verification PASSED.`);
    return;
  }

  const staffers = await loadStaffers(supabase);
  const actionable = staffers.filter((s) => s.authId !== null);
  const skipped = staffers.filter((s) => s.authId === null);
  const { count: staffUserCount } = await supabase
    .from('StaffUser')
    .select('*', { count: 'exact', head: true });
  const { count: assignmentCount } = await supabase
    .from('StaffAssignment')
    .select('*', { count: 'exact', head: true });
  console.log(
    `Staffers found: ${staffers.length} (actionable: ${actionable.length}, skipped, no auth identity: ${skipped.length})`,
  );
  for (const s of skipped) console.log(`  SKIP ${s.email} - no auth.users account`);
  for (const s of actionable) {
    console.log(
      `  ${s.email} authId=${s.authId} slugs=[${s.slugs.join(',')}] => status=${staffStatusFor(s.accountStatus)}`,
    );
  }
  console.log(
    `Existing StaffUser rows: ${staffUserCount ?? 0}, StaffAssignment rows: ${assignmentCount ?? 0}`,
  );

  // Attribution preview (rows still pointing at member uuids). Only actionable
  // staffers (those with an auth identity to key StaffUser off) are remapped.
  const pending: { table: string; idColumn: string; id: string; column: string; before: string }[] =
    [];
  const memberIds = new Set(actionable.map((s) => s.memberId));
  const skippedIds = new Set(skipped.map((s) => s.memberId));
  for (const t of ATTRIBUTIONS) {
    const { data, error } = await supabase
      .from(t.table)
      .select(`${t.idColumn}, ${t.actorColumn}`)
      .limit(5000);
    if (error) {
      console.log(`${t.table}: lookup failed (${error.message})`);
      continue;
    }
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const owner = row[t.actorColumn];
      if (typeof owner === 'string' && memberIds.has(owner)) {
        pending.push({
          table: t.table,
          idColumn: t.idColumn,
          id: String(row[t.idColumn]),
          column: t.actorColumn,
          before: owner,
        });
      }
    }
  }
  console.log(`Attributions to remap: ${pending.length}`);

  if (mode === 'dry-run') {
    console.log(
      `\nDRY-RUN - no changes made. Re-run with --execute plus DEV_RESET_ALLOW_REFS=${ref} to create staff identities and remap attributions.`,
    );
    return;
  }

  if (!allowed(ref)) process.exit(1);

  // --execute: create/reuse staff users (keyed by auth id) + upsert assignments.
  const created: { id: string; email: string }[] = [];
  const memberToStaff = new Map<string, string>();
  for (const s of actionable) {
    const staffId = s.authId as string;
    const { data: existing, error: lookupErr } = await supabase
      .from('StaffUser')
      .select('id')
      .eq('id', staffId)
      .maybeSingle();
    if (lookupErr) throw new Error(`StaffUser lookup ${s.email} failed: ${lookupErr.message}`);
    const existingId = (existing as { id?: string } | null)?.id;
    if (!existingId) {
      const { error } = await supabase.from('StaffUser').insert({
        id: staffId,
        email: s.email,
        name: s.name,
        status: staffStatusFor(s.accountStatus),
      });
      if (error) throw new Error(`insert StaffUser ${s.email} failed: ${error.message}`);
      created.push({ id: staffId, email: s.email });
    }
    memberToStaff.set(s.memberId, staffId);
    for (const roleId of s.roleIds) {
      const { error } = await supabase
        .from('StaffAssignment')
        .upsert({ staffUserId: staffId, roleId }, { onConflict: 'staffUserId,roleId' });
      if (error) throw new Error(`upsert StaffAssignment ${s.email} failed: ${error.message}`);
    }
  }
  console.log(
    `\nStaff users new: ${created.length}, reused: ${actionable.length - created.length}, skipped (no auth): ${skipped.length}.`,
  );

  // Remap attributions member uuid -> staff uuid.
  let remapped = 0;
  for (const p of pending) {
    const staffId = memberToStaff.get(p.before);
    if (!staffId) continue;
    const { error } = await supabase
      .from(p.table)
      .update({ [p.column]: staffId })
      .eq(p.idColumn, p.id);
    if (error) throw new Error(`remap ${p.table} ${p.id} failed: ${error.message}`);
    remapped += 1;
  }
  console.log(`Remapped attributions: ${remapped}/${pending.length}.`);

  // Persist rollback map (created rows only + original values).
  const map: RollbackMap = {
    staffUsers: created,
    attributions: pending
      .filter((p) => memberToStaff.has(p.before))
      .map((p) => ({
        table: p.table,
        idColumn: p.idColumn,
        id: p.id,
        column: p.column,
        before: p.before,
      })),
  };
  fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));
  console.log(`Rollback map written to ${MAP_PATH}.`);

  // Verify by coverage (not by value): seed aligns Member.id with auth ids,
  // so staff uuids equal member uuids during transition and a value rewrite
  // is a no-op by design. What matters: every actionable staffer uuid has a
  // StaffUser row (so the new domain covers all staff attributions), and no
  // attribution points at a staffer uuid WITHOUT one. References owned by
  // skipped staffers (no auth identity) are reported but left in place.
  const { data: staffRows } = await supabase.from('StaffUser').select('id');
  const staffIds = new Set(((staffRows ?? []) as { id: string }[]).map((r) => r.id));
  let uncovered = 0;
  let leftInPlace = 0;
  for (const t of ATTRIBUTIONS) {
    const { data } = await supabase.from(t.table).select(t.actorColumn).limit(5000);
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const owner = row[t.actorColumn];
      if (typeof owner !== 'string') continue;
      if (memberIds.has(owner) && !staffIds.has(owner)) uncovered += 1;
      else if (skippedIds.has(owner)) leftInPlace += 1;
    }
  }
  const missingStaff = [...memberIds].filter((id) => !staffIds.has(id));
  console.log(`Staffer uuids without a StaffUser row: ${missingStaff.length}`);
  console.log(`Attributions pointing at uncovered staffer uuids: ${uncovered}`);
  console.log(`Left in place (no auth identity): ${leftInPlace}`);
  if (uncovered > 0 || missingStaff.length > 0) {
    for (const id of missingStaff) console.log(`  uncovered staffer uuid: ${id}`);
    console.error('Verification FAILED.');
    process.exit(2);
  }
  console.log('Verification PASSED.');

  function allowed(projectRef: string): boolean {
    const list = (process.env.DEV_RESET_ALLOW_REFS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.includes(projectRef)) {
      console.error(
        `Refusing: project ref "${projectRef}" is not listed in DEV_RESET_ALLOW_REFS. Aborting with no changes.`,
      );
      return false;
    }
    return true;
  }
}

void main().catch((err: unknown) => {
  console.error('backfill failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
