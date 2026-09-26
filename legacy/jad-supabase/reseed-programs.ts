/**
 * Reseed program reference data (Phase B follow-up).
 *
 * Context: `purge-seed-keep-core.ts` deliberately deletes every table except
 * `cms_contents` + `SystemConfig`, which emptied `Program` (2 rows) and
 * `ProgramQuestion` (4 rows). The register page (`GET /programs`) then
 * renders an empty program list and leaks the raw program id
 * (`prg-domestic`) through its label fallback. This script restores exactly
 * the canonical seeds - same source + shapes `supabase/seed.ts` uses
 * (`packages/contracts/src/seeds/reference.ts`), so parity holds.
 *
 * Idempotent: plain upserts on `id`; safe to re-run.
 *
 * Safety model (fail-closed, same as the other supabase scripts):
 * - Default mode is DRY-RUN: SELECTs only, changes nothing.
 * - `--execute` additionally requires the target project ref in
 *   `DEV_RESET_ALLOW_REFS`. Anything else aborts.
 *
 * Usage:
 *   pnpm exec tsx supabase/reseed-programs.ts                                      # dry-run
 *   DEV_RESET_ALLOW_REFS=<ref> pnpm exec tsx supabase/reseed-programs.ts --execute
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

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const mode = args.has('--execute') ? 'execute' : 'dry-run';

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  const ref = projectRefFromUrl(supabaseUrl);
  if (!ref || ref.includes('your-project')) {
    console.error('Could not resolve a Supabase project ref. Aborting.');
    process.exit(1);
  }
  console.log(`Target project ref: ${ref}`);
  console.log(`Mode: ${mode}`);

  const refMod = await import('../packages/contracts/src/seeds/reference');
  const programs = refMod.PROGRAM_SEEDS as { id: string; code: string; name: string }[];
  const questionGroups = refMod.PROGRAM_QUESTION_SEEDS as {
    programId: string;
    questions: { id: string; questionText: string }[];
  }[];
  const questionCount = questionGroups.reduce((sum, g) => sum + g.questions.length, 0);
  console.log(
    `Seeds: ${programs.length} programs (${programs.map((p) => p.id).join(', ')}), ${questionCount} questions`,
  );

  const supabase = serviceClient();
  const { count: programCount } = await supabase
    .from('Program')
    .select('*', { count: 'exact', head: true });
  const { count: questionCountLive } = await supabase
    .from('ProgramQuestion')
    .select('*', { count: 'exact', head: true });
  console.log(`Live rows: Program=${programCount ?? 0}, ProgramQuestion=${questionCountLive ?? 0}`);

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

  for (const p of programs) {
    const { error } = await supabase.from('Program').upsert(p, { onConflict: 'id' });
    if (error) {
      console.error(`Program seed ${p.id} failed: ${error.message}`);
      process.exit(1);
    }
    console.log(`Program ready: ${p.id}`);
  }
  for (const group of questionGroups) {
    for (const q of group.questions) {
      const { error } = await supabase
        .from('ProgramQuestion')
        .upsert(
          { id: q.id, programId: group.programId, questionText: q.questionText },
          { onConflict: 'id' },
        );
      if (error) {
        console.error(`ProgramQuestion seed ${q.id} failed: ${error.message}`);
        process.exit(1);
      }
    }
  }
  console.log('Program questions ready');

  const { count: programAfter } = await supabase
    .from('Program')
    .select('*', { count: 'exact', head: true });
  const { count: questionsAfter } = await supabase
    .from('ProgramQuestion')
    .select('*', { count: 'exact', head: true });
  console.log(
    `Verified: Program=${programAfter ?? 0} (expected ${programs.length}), ` +
      `ProgramQuestion=${questionsAfter ?? 0} (expected ${questionCount})`,
  );
  if (programAfter !== programs.length || questionsAfter !== questionCount) {
    console.error('Verification FAILED - inspect output above.');
    process.exit(2);
  }
  console.log('Reseed complete.');
}

void main().catch((err: unknown) => {
  console.error('reseed-programs failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
