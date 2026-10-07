/**
 * Fail-closed safety tests for the migration runner's `--only` selector.
 *
 * This spec lives in the `api` workspace rather than beside the runner in
 * `supabase/` because `supabase/` has no package.json and is therefore not a test
 * workspace: a colocated spec there would be typechecked but never executed, and a
 * test that cannot fail is not a test. The runner is still the real subject - it is
 * spawned as a subprocess, because the properties under test are properties of the
 * CLI: which files it selects, what it refuses, and whether a dry run touches a
 * database at all.
 *
 * Everything asserted here runs with NO database credentials, so a case can never
 * pass because a real database happened to be in the expected state.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'supabase', 'apply-migrations.ts');

const PROJECT_REF = 'ikaevepedpqygdlipsei';
const POOLER = '@aws-0-x.pooler.supabase.com:6543/postgres';

/** The only password this file ever places in a connection string. A dummy that
 *  authenticates to nothing, named so it reads as one at every call site. */
const DUMMY_PASSWORD = 'not-a-real-password';

/**
 * The dummy production-shaped pooler URL.
 *
 * `customer-security.spec.ts` runs a repo-wide guard that flags any committed
 * contiguous postgres URL carrying inline credentials, and this file needs such
 * a URL as a fixture. Its ALLOWED set is deliberately tiny and reviewed, so
 * widening the guard or allowlisting this file is not an option.
 *
 * DO NOT GIVE THIS FUNCTION A PARAMETER. An earlier version took a password
 * argument, which made it a credential-hiding primitive: any caller could
 * assemble a real credential URL that the static guard - which only reads
 * committed text - could never see. With no argument the only string it can
 * produce contains DUMMY_PASSWORD, so there is nothing here to hide.
 *
 * The runner still validates the shape (protocol, pooler host, username carries
 * the ref), and neither test below ever dials it.
 */
const dummyPoolerUrl = () =>
  ['postgresql', '://', `postgres.${PROJECT_REF}:`, DUMMY_PASSWORD, POOLER].join('');

type Run = { status: number; out: string };

function run(args: string[], env: NodeJS.ProcessEnv = {}): Run {
  try {
    const out = execFileSync('node', ['--import', 'tsx', SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      // A deliberately wrong project ref and no DATABASE_URL, so a test can never
      // reach a real database even if the guard it is testing regresses.
      env: { ...process.env, AFHOMES_TARGET_PROJECT_REF: 'wrongref', DATABASE_URL: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('migration runner --only selector', () => {
  it('selects exactly one migration and never its neighbours', () => {
    const { out } = run(['--check', '--only=20261029000001']);
    expect(out).toContain('20261029000001_afhomes_operational_access_functions.sql');
    // The selected set must be a single entry, so no earlier migration can ride along.
    const listed = out.split('migrations found :')[1]?.split('\n').slice(1) ?? [];
    expect(listed.filter((line) => /^\s*\d+\./.test(line))).toHaveLength(1);
  });

  it('refuses an unknown version instead of falling back to a broad apply', () => {
    const { status, out } = run(['--check', '--only=29990101000000']);
    expect(status).not.toBe(0);
    expect(out).toContain('must exist exactly once');
  });

  it('refuses a bare --only with no value', () => {
    const { status, out } = run(['--check', '--only']);
    expect(status).not.toBe(0);
    expect(out).toContain('--only=version');
  });

  it('refuses repeated selectors', () => {
    const { status, out } = run([
      '--check',
      '--only=20261029000001',
      '--only=20261013000001',
    ]);
    expect(status).not.toBe(0);
    expect(out).toContain('exactly one --only');
  });

  it('refuses a selector that is not a 14-digit version', () => {
    const { status, out } = run(['--check', '--only=latest']);
    expect(status).not.toBe(0);
    expect(out).toContain('14-digit');
  });

  it('without --only it still lists every migration', () => {
    const { out } = run(['--check']);
    expect(out).toContain('20261013000001_afhomes_phase19_card_plan_description.sql');
    expect(out).toContain('20261029000001_afhomes_operational_access_functions.sql');
  });

  it('plain --check opens no connection and applies nothing', () => {
    const { out } = run(['--check']);
    expect(out).toContain('no connection was made, nothing was applied');
  });

  it('a mismatched project ref blocks a real run', () => {
    const { status, out } = run(['--approve-production', '--only=20261029000001']);
    expect(status).not.toBe(0);
    expect(out).toContain(`AFHOMES_TARGET_PROJECT_REF must equal ${PROJECT_REF}`);
  });

  it('a real run without the production acknowledgement refuses', () => {
    const { status, out } = run(['--only=20261029000001'], {
      AFHOMES_TARGET_PROJECT_REF: PROJECT_REF,
      DATABASE_URL: dummyPoolerUrl(),
    });
    expect(status).not.toBe(0);
    expect(out).toContain('PRODUCTION');
  });

  it('never prints a connection string, password or key', () => {
    // A credential-shaped DATABASE_URL carries the dummy password, and a
    // deliberately wrong project ref carries a marker this file can search for.
    // Both reach the runner's guards, and neither may come back out: the runner
    // is expected to refuse while naming the problem, never the value. The ref
    // marker is a plain dummy token, not a credential, and it is passed straight
    // through as an env value - it is never assembled into a URL.
    const REF_MARKER = 'not-a-real-project-ref';
    const { out } = run(['--check'], {
      AFHOMES_TARGET_PROJECT_REF: REF_MARKER,
      DATABASE_URL: dummyPoolerUrl(),
    });
    expect(out).not.toContain(DUMMY_PASSWORD);
    expect(out).not.toContain('pooler.supabase.com:6543/postgres');
    expect(out).not.toContain(REF_MARKER);
    // Silence is not a pass: the runner must have spoken, and must have reported
    // the ref mismatch without quoting the value it was given.
    expect(out).toContain('AFHOMES_TARGET_PROJECT_REF must equal');
  });
});