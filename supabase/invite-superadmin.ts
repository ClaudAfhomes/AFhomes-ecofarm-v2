/**
 * One-time, idempotent Super Admin bootstrap.
 *
 * Security properties (do not weaken):
 *  - Never accepts, stores, or reads a password. The owner sets their own via
 *    the Supabase-hosted recovery flow after accepting the invitation.
 *  - Only the service-role key is used, only server-side, and only from env.
 *  - Refuses to run against any project other than the expected one.
 *  - Deletes an auth user ONLY when this run created it. A pre-existing user is
 *    never destroyed by a failed re-run.
 *
 * Safe to run repeatedly. Each of the six partial states is reconciled:
 *
 *  1. no auth user            -> invite, then create profile + assignment
 *  2. auth user, no profile   -> create the profile
 *  3. profile, no assignment  -> create the assignment
 *  4. assignment, wrong role  -> correct it to super_admin
 *  5. already correct         -> report "already bootstrapped", change nothing
 *  6. duplicate execution     -> same as (5); no error, no duplicate rows
 *
 * Usage:
 *   npx pnpm bootstrap:superadmin          # reconcile (writes)
 *   npx pnpm bootstrap:superadmin -- --check   # config only, no network
 *
 * RUNTIME NOTE - why there is no top-level `await` in this file:
 * the repository root `package.json` declares no `"type"` field, so a `.ts` file
 * under `supabase/` (which has no package.json of its own) is treated as
 * CommonJS by Node's resolver. esbuild/tsx therefore targets the CJS output
 * format, where a top-level `await` is a syntax error, even though
 * `tsc` accepts it (`tsconfig.base.json` sets `"module": "ESNext"`). The
 * `api/` workspace avoids this by declaring `"type": "module"`. Rather than
 * switching the whole repository to ESM for one operator script, all of the
 * async work lives in `main()`. That form runs correctly under BOTH the CJS and
 * the ESM resolution, so it stays valid if the root `"type"` ever changes.
 */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import fs from 'node:fs';
import { loadEnvFile } from 'node:process';

if (fs.existsSync('.env.local')) loadEnvFile('.env.local');

const EXPECTED_PROJECT_HOST = 'ikaevepedpqygdlipsei.supabase.co';
const CHECK_ONLY = process.argv.includes('--check');

/**
 * A failure that has already been reported in context. The top-level handler
 * exits non-zero for it without printing a redundant message or a stack trace.
 */
class ReportedFailure extends Error {
  override name = 'ReportedFailure';
}

type BootstrapConfig = {
  url: string;
  serviceRoleKey: string;
  email: string;
  redirectTo: string;
};

/* ---------------------------------------------------------------- */
/* Configuration                                                     */
/* ---------------------------------------------------------------- */

/**
 * Read and validate the operator environment. Performs no network call and
 * creates no client. Returns `null` after reporting every problem, so a
 * misconfigured run fails closed before anything is written.
 */
function readConfig(): BootstrapConfig | null {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.AFHOMES_SUPERADMIN_EMAIL?.trim().toLowerCase();
  const redirectTo = process.env.AFHOMES_ADMIN_URL;

  const problems: string[] = [];
  if (!url) problems.push('SUPABASE_URL is required.');
  if (!serviceRoleKey) problems.push('SUPABASE_SERVICE_ROLE_KEY is required.');
  if (!email) problems.push('AFHOMES_SUPERADMIN_EMAIL is required.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    problems.push('AFHOMES_SUPERADMIN_EMAIL is not a valid email address.');
  if (!redirectTo) problems.push('AFHOMES_ADMIN_URL is required (invite redirect target).');
  if (url && !url.includes(EXPECTED_PROJECT_HOST))
    problems.push(`Refusing to run: SUPABASE_URL is not ${EXPECTED_PROJECT_HOST}.`);

  if (problems.length > 0) {
    console.error('[afhomes:bootstrap] Configuration is not ready:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      '[afhomes:bootstrap] Set these in a secure operator environment, apply supabase/migrations first, then re-run.',
    );
    process.exitCode = 1;
    return null;
  }

  // Narrowed by the checks above: none of these can be empty here.
  return { url: url!, serviceRoleKey: serviceRoleKey!, email: email!, redirectTo: redirectTo! };
}

/* ---------------------------------------------------------------- */
/* Reconciliation                                                    */
/* ---------------------------------------------------------------- */

/** Find an auth user by email across a bounded number of pages. */
async function findAuthUserByEmail(supabase: SupabaseClient, target: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find(
      (user: User) => user.email?.toLowerCase() === target || user.phone === target,
    );
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function main(): Promise<void> {
  // 1. Validate first. A misconfigured run never reaches the network.
  const config = readConfig();
  if (!config) return;
  const { email, redirectTo } = config;

  if (CHECK_ONLY) {
    // Local validation only - no network call, no client, no write.
    console.log('[afhomes:bootstrap] --check: configuration is valid. No network call was made.');
    console.log(`[afhomes:bootstrap] target project : ${EXPECTED_PROJECT_HOST}`);
    console.log(`[afhomes:bootstrap] super admin    : ${email}`);
    console.log(`[afhomes:bootstrap] invite redirect: ${redirectTo}`);
    return;
  }

  // 2. Only now is a service-role client constructed, and only from env.
  const supabase: SupabaseClient = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const existingUser = await findAuthUserByEmail(supabase, email);
  let userId = existingUser?.id ?? '';
  /** Only a user this run created may be deleted on failure. */
  let createdUser = false;
  const actions: string[] = [];

  if (existingUser) {
    actions.push(`auth user already exists (${existingUser.id}) - no invitation re-sent`);
  } else {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { bootstrap: 'afhomes-super-admin' },
    });
    if (error || !data.user) {
      console.error('[afhomes:bootstrap] Invitation failed:', error?.message ?? 'no user returned');
      console.error('[afhomes:bootstrap] Nothing was written. Fix the cause and re-run.');
      // Nothing was created, so there is nothing to roll back.
      process.exitCode = 1;
      throw new ReportedFailure('invitation failed');
    }
    userId = data.user.id;
    createdUser = true;
    actions.push(`invitation sent to ${email}`);
  }

  try {
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('id, name')
      .eq('slug', 'super_admin')
      .single();
    if (roleError || !role) {
      throw new Error(
        `The super_admin role is missing. Apply supabase/migrations before bootstrapping. (${
          roleError?.message ?? 'not found'
        })`,
      );
    }

    // A profile under a different id for the same email is a genuine conflict
    // that must be reconciled by hand - never silently reassigned.
    const { data: byEmail, error: byEmailError } = await supabase
      .from('staff_users')
      .select('id, status')
      .eq('email', email)
      .maybeSingle();
    if (byEmailError) throw byEmailError;
    if (byEmail && byEmail.id !== userId) {
      throw new Error(
        `A staff profile already exists for ${email} under a different auth id (${byEmail.id}). ` +
          'Reconcile it manually before bootstrapping; this script will not move it.',
      );
    }

    if (byEmail) {
      actions.push(`staff profile already present (status: ${byEmail.status}) - left unchanged`);
    } else {
      const { error: staffError } = await supabase.from('staff_users').insert({
        id: userId,
        email,
        full_name: 'AF Homes Super Admin',
        status: 'invited',
        invited_at: new Date().toISOString(),
      });
      if (staffError) throw staffError;
      actions.push('staff profile created (status: invited)');
    }

    const { data: assignment, error: assignmentReadError } = await supabase
      .from('staff_role_assignments')
      .select('role_id')
      .eq('staff_id', userId)
      .maybeSingle();
    if (assignmentReadError) throw assignmentReadError;

    if (!assignment) {
      const { error: assignmentError } = await supabase
        .from('staff_role_assignments')
        .insert({ staff_id: userId, role_id: role.id });
      if (assignmentError) throw assignmentError;
      actions.push(`role assignment created (${role.name})`);
    } else if (assignment.role_id !== role.id) {
      const { error: reassignError } = await supabase
        .from('staff_role_assignments')
        .update({ role_id: role.id, assigned_by: null })
        .eq('staff_id', userId);
      if (reassignError) throw reassignError;
      actions.push(`role assignment corrected to ${role.name}`);
    } else {
      actions.push(`role assignment already correct (${role.name})`);
    }

    // Append-only audit trail: one row per reconciliation run.
    const { error: auditError } = await supabase.from('audit_events').insert({
      actor_id: userId,
      action: 'SUPER_ADMIN_INVITED',
      entity_type: 'staff_user',
      entity_id: userId,
      after_data: { email, role: 'super_admin', bootstrap: true, invitedNow: createdUser },
    });
    if (auditError) throw auditError;
    actions.push('audit event appended (SUPER_ADMIN_INVITED)');

    console.log('[afhomes:bootstrap] Super Admin is ready:');
    for (const action of actions) console.log(`  - ${action}`);
    if (createdUser) {
      console.log(
        `[afhomes:bootstrap] Next: ${email} must accept the invitation and set their own password.`,
      );
    } else {
      console.log(
        '[afhomes:bootstrap] No invitation was sent. If the owner has not set a password yet, send one from Supabase Auth.',
      );
    }
  } catch (bootstrapError) {
    if (createdUser && userId) {
      // Roll back only the account this run created.
      await supabase.auth.admin.deleteUser(userId);
      console.error(
        '[afhomes:bootstrap] Failed; the auth user created by this run was removed. No partial state remains.',
      );
    } else {
      console.error(
        '[afhomes:bootstrap] Failed; the pre-existing auth user was NOT modified or deleted. Fix the cause and re-run.',
      );
    }
    throw bootstrapError;
  }
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  // Already reported in context, with the operator-facing explanation.
  if (error instanceof ReportedFailure) return;
  // Log the message only. Dumping an arbitrary error object can print request
  // details or credentials attached by the client.
  console.error('[afhomes:bootstrap] Failed:', error instanceof Error ? error.message : error);
});
