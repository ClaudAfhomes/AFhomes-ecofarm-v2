/**
 * Provision the production super-admin after the seed purge (Phase C).
 *
 * Run AFTER `purge-seed-keep-core.ts --execute` (which deletes the Role
 * catalog and all seed auth users while preserving `cms_contents` +
 * `SystemConfig`).
 *
 * Steps (idempotent - safe to re-run):
 *   1. Rebuild the canonical Role catalog (7 slugs: super_admin, admin,
 *      finance, merchant [staff] + user, member_basic, member_qualified
 *      [member]). Values mirror `20260904000001_staff_roles.sql`,
 *      `20260908000001_member_pipeline.sql`, and `supabase/seed.ts`.
 *   2. Create (or reuse) the Supabase Auth user for the production
 *      super-admin and set its password from env.
 *   3. Upsert the staff-only identity: `StaffUser` (never a `Member` row) +
 *      `StaffAssignment` → `super_admin`.
 *
 * Identity comes ONLY from local env (never committed, never VITE_):
 *   SUPABASE_PROD_SUPERADMIN_EMAIL     (required, e.g. admin@jadrealty.ph)
 *   SUPABASE_PROD_SUPERADMIN_PASSWORD  (required, min 12 chars)
 *   SUPABASE_PROD_SUPERADMIN_NAME      (optional, default "Super Admin")
 *
 * Safety model (fail-closed):
 * - Default mode is DRY-RUN: SELECTs + auth lookups only, changes nothing.
 * - `--execute` additionally requires the target project ref in
 *   `DEV_RESET_ALLOW_REFS` (same guard as the purge/reset scripts).
 * - Refuses `@jad.local` test-domain emails unless `--allow-test-domain` is
 *   passed (prod identity must be a real address).
 *
 * Usage:
 *   pnpm exec tsx supabase/provision-superadmin.ts                                     # dry-run
 *   DEV_RESET_ALLOW_REFS=<ref> pnpm exec tsx supabase/provision-superadmin.ts --execute
 */

import fs from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { STAFF_PERMISSIONS } from '../packages/contracts/src/schemas/staff-role.js';

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

/** Canonical Role catalog (mirrors the staff-roles + member-pipeline migrations and seed.ts).
 * Permissions converge to the STAFF_PERMISSIONS matrix seed (single source; member
 * rows keep the empty set) so GET /admin/roles never drops them after a purge. */
const ROLE_SEEDS: { slug: string; name: string; description: string; domain: string }[] = [
  {
    slug: 'super_admin',
    name: 'Super Admin',
    description: 'Platform super user - full governance (BUSINESS-RULES #3)',
    domain: 'staff',
  },
  {
    slug: 'admin',
    name: 'Admin',
    description: 'Admin dashboard - Phase 1',
    domain: 'staff',
  },
  {
    slug: 'finance',
    name: 'Finance',
    description: 'Payment verification scope (BUSINESS-RULES #3)',
    domain: 'staff',
  },
  {
    slug: 'merchant',
    name: 'Merchant',
    description: 'Voucher redemption scope (BUSINESS-RULES #3)',
    domain: 'staff',
  },
  {
    slug: 'user',
    name: 'User',
    description: 'User dashboard - Phase 1',
    domain: 'member',
  },
  {
    slug: 'member_basic',
    name: 'Member',
    description: 'Base member - single category default',
    domain: 'member',
  },
  {
    slug: 'member_qualified',
    name: 'Qualified',
    description: 'Qualified member',
    domain: 'member',
  },
];

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

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const mode = args.has('--execute') ? 'execute' : 'dry-run';
  const allowTestDomain = args.has('--allow-test-domain');

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  const ref = projectRefFromUrl(supabaseUrl);
  if (!ref || ref.includes('your-project')) {
    console.error('Could not resolve a Supabase project ref. Aborting.');
    process.exit(1);
  }

  const email = (process.env.SUPABASE_PROD_SUPERADMIN_EMAIL ?? '').trim();
  const password = process.env.SUPABASE_PROD_SUPERADMIN_PASSWORD ?? '';
  const name = (process.env.SUPABASE_PROD_SUPERADMIN_NAME ?? '').trim() || 'Super Admin';

  if (!email || !validEmail(email)) {
    console.error(
      'Missing/invalid SUPABASE_PROD_SUPERADMIN_EMAIL in .env (local only, never commit).',
    );
    process.exit(1);
  }
  if (!password || password.length < 12) {
    console.error(
      'Missing/weak SUPABASE_PROD_SUPERADMIN_PASSWORD in .env (min 12 chars, local only, never commit).',
    );
    process.exit(1);
  }
  if (email.toLowerCase().endsWith('@jad.local') && !allowTestDomain) {
    console.error(
      'Refusing: @jad.local is the test domain. Use a real production address, or pass --allow-test-domain for a staging rehearsal.',
    );
    process.exit(1);
  }

  console.log(`Target project ref: ${ref}`);
  console.log(`Mode: ${mode}`);
  console.log(`Super-admin: ${email} (${name}) - staff-only identity (no Member row)`);

  const supabase = serviceClient();

  // Pre-checks (read-only): current roles, existing auth user, existing staff row.
  const { data: existingRoles } = await supabase.from('Role').select('slug,name,domain');
  const have = new Set(((existingRoles as { slug: string }[] | null) ?? []).map((r) => r.slug));
  const missingRoles = ROLE_SEEDS.filter((r) => !have.has(r.slug));
  console.log(
    `Roles present: ${have.size > 0 ? [...have].sort().join(', ') : '(none)'}; to upsert: ${missingRoles.length > 0 ? missingRoles.map((r) => r.slug).join(', ') : '(all present - re-upsert for convergence)'}`,
  );

  const { data: listed } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existingAuth = (listed?.users ?? []).find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  console.log(
    `Auth user ${email}: ${existingAuth ? `exists (${existingAuth.id}) - password will be rotated` : 'absent - will be created'}`,
  );

  if (mode === 'dry-run') {
    console.log(
      '\nDRY-RUN - no changes made. Re-run with --execute plus DEV_RESET_ALLOW_REFS=' + ref,
    );
    return;
  }

  const allowed = (process.env.DEV_RESET_ALLOW_REFS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(ref)) {
    console.error(
      `Refusing: project ref "${ref}" is not listed in DEV_RESET_ALLOW_REFS. Aborting with no changes.`,
    );
    process.exit(1);
  }

  // 1. Role catalog (idempotent upserts on slug).
  for (const r of ROLE_SEEDS) {
    const { error } = await supabase.from('Role').upsert(
      {
        ...r,
        permissions: [...((STAFF_PERMISSIONS as Record<string, readonly string[]>)[r.slug] ?? [])],
        is_system: true,
      },
      { onConflict: 'slug' },
    );
    if (error) {
      console.error(`Role upsert ${r.slug} failed: ${error.message}`);
      process.exit(1);
    }
    console.log(`Role ready: ${r.slug} (${r.domain})`);
  }
  const { data: roleRows } = await supabase.from('Role').select('id,slug');
  const roleIdBySlug: Record<string, string> = {};
  for (const r of (roleRows as { id: string; slug: string }[] | null) ?? [])
    roleIdBySlug[r.slug] = r.id;
  const superRid = roleIdBySlug['super_admin'];
  if (!superRid) {
    console.error('super_admin role id unresolvable after upsert. Aborting.');
    process.exit(1);
  }

  // 2. Auth user (create or reuse + rotate password).
  let authId = existingAuth?.id;
  if (!authId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error) {
      console.error(`Auth user creation failed: ${error.message}`);
      process.exit(1);
    }
    authId = (data as { user?: { id: string } } | null)?.user?.id;
    console.log(`Auth user created: ${email}`);
  } else {
    const { error } = await supabase.auth.admin.updateUserById(authId, {
      password,
      user_metadata: { full_name: name },
    });
    if (error) {
      console.error(`Auth password rotation failed: ${error.message}`);
      process.exit(1);
    }
    console.log(`Auth password rotated: ${email}`);
  }
  if (!authId) {
    console.error('Auth user id unresolvable. Aborting.');
    process.exit(1);
  }

  // 3. Staff-only identity (never a Member row).
  const { error: staffErr } = await supabase
    .from('StaffUser')
    .upsert({ id: authId, email, name, status: 'ACTIVE' }, { onConflict: 'id' });
  if (staffErr) {
    console.error(`StaffUser upsert failed: ${staffErr.message}`);
    process.exit(1);
  }
  console.log(`Staff user ready: ${email}`);
  const { error: assignErr } = await supabase
    .from('StaffAssignment')
    .upsert({ staffUserId: authId, roleId: superRid }, { onConflict: 'staffUserId,roleId' });
  if (assignErr) {
    console.error(`StaffAssignment failed: ${assignErr.message}`);
    process.exit(1);
  }
  console.log(`Role assigned: ${email} -> super_admin (staff domain)`);

  // 4. Verification: no Member row for this identity; session resolvability.
  const { data: strayMember } = await supabase
    .from('Member')
    .select('id')
    .eq('id', authId)
    .maybeSingle();
  if (strayMember) {
    console.error(
      'INVARIANT VIOLATION: super-admin holds a Member row - staff/member separation broken.',
    );
    process.exit(2);
  }
  console.log(
    '\nProvisioning complete. Verify: login as the new address → /admin must load with full governance.',
  );
  console.log('Then run `supabase/security/rls_invariants.sql` (empty = PASS).');
}

void main().catch((err: unknown) => {
  console.error('provision-superadmin failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
