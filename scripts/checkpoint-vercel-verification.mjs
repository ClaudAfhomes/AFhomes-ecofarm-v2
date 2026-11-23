// Read-only checkpoint verification; raw CLI responses never leave this process.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const projectId = 'prj_apBNxtW4R8E7JohbFg6K8aUGin4j';
const teamId = 'team_Z85dMbGy92EW0TavrIP4Yb1Y';
const cache = path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx');
const entries = fs
  .readdirSync(cache)
  .map((folder) => path.join(cache, folder, 'node_modules', 'vercel', 'package.json'));
const packageFile = entries.find(
  (file) => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).version === '63.1.2',
);
assert(packageFile, 'Existing reviewed Vercel CLI 63.1.2 is unavailable');
const cli = path.join(path.dirname(packageFile), 'dist', 'vc.js');

function diagnostic(stderr, status) {
  // Only known error text is emitted: arbitrary CLI bodies may contain secrets.
  if (/Invalid arguments/.test(stderr))
    return {
      category: 'CLI_ARGUMENTS',
      message:
        'Invalid arguments. Use an API path starting with /, or run vercel api interactively.',
    };
  if (
    /401|not authenticated|No existing credentials|token.*(?:expired|invalid)|invalid token|login required/i.test(
      stderr,
    )
  )
    return { category: 'AUTHENTICATION', message: 'Vercel login or credential renewal required.' };
  if (/403|forbidden|not authorized|permission|access denied/i.test(stderr))
    return { category: 'PERMISSION', message: 'Vercel team/project access denied.' };
  if (/404|not found|scope.*invalid/i.test(stderr))
    return { category: 'TARGET_OR_SCOPE', message: 'Vercel target or scope unavailable.' };
  return {
    category: 'CLI_OR_PROCESS',
    message: `Required Vercel check failed (exit ${status}); unrecognized output withheld.`,
  };
}
function run(args, json = false) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    maxBuffer: 10_000_000,
    timeout: 45000,
    env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1' },
  });
  if (result.error || result.status !== 0) {
    const error = new Error('Required Vercel verification failed');
    error.exitCode = result.status ?? 1;
    error.diagnostic = diagnostic(
      (result.stderr ?? '') + '\n' + (result.stdout ?? ''),
      error.exitCode,
    );
    throw error;
  }
  if (!json) return result.stdout.trim();
  try {
    return JSON.parse(result.stdout);
  } catch {
    const error = new Error('CLI returned invalid JSON');
    error.exitCode = 1;
    error.diagnostic = {
      category: 'CLI_RESPONSE',
      message: 'Required CLI response was not valid JSON.',
    };
    throw error;
  }
}
const get = (endpoint) =>
  run(['api', endpoint, '--scope', 'afhomes', '--method', 'GET', '--raw'], true);
const summarize = (d) => ({
  id: d.id ?? d.uid,
  url: d.url,
  target: d.target,
  readyState: d.readyState ?? d.state,
  gitSha: d.meta?.githubCommitSha ?? d.gitSource?.sha,
  gitBranch: d.meta?.githubCommitRef ?? d.gitSource?.ref,
  projectId: d.projectId,
});

try {
  if (process.argv.includes('--self-test')) {
    assert.equal(
      diagnostic('Error: Invalid arguments. token=synthetic-secret', 2).category,
      'CLI_ARGUMENTS',
    );
    assert.equal(diagnostic('401 token expired synthetic-secret', 1).category, 'AUTHENTICATION');
    assert.equal(diagnostic('403 forbidden synthetic-secret', 1).category, 'PERMISSION');
    assert.equal(diagnostic('404 not found', 1).category, 'TARGET_OR_SCOPE');
    assert(!JSON.stringify(diagnostic('Bearer synthetic-secret', 2)).includes('synthetic-secret'));
    assert.throws(
      () => run(['api', 'invalid-path', '--scope', 'afhomes', '--method', 'GET', '--raw']),
      (error) => error.exitCode === 2 && error.diagnostic.category === 'CLI_ARGUMENTS',
    );
    console.log(
      'PASS: diagnostic classification, secret withholding, and required-check exit code 2',
    );
  } else {
    const cliVersion = run(['--version']);
    const authenticatedUser = run(['whoami', '--scope', 'afhomes']);
    const project = get(`/v9/projects/${projectId}?teamId=${teamId}`);
    assert.equal(project.id, projectId);
    assert.equal(project.accountId, teamId);
    assert.equal(project.name, 'afhomes-ecofarm-v2');
    const history = get(
      `/v6/deployments?projectId=${projectId}&teamId=${teamId}&target=production&limit=1`,
    );
    const current = project.targets?.production;
    assert(current, 'No current Production deployment');
    const deployment = get(`/v13/deployments/${current.id}?teamId=${teamId}`);
    assert.equal(deployment.projectId, projectId);
    assert.equal(deployment.readyState, 'READY');
    const variables = get(`/v10/projects/${projectId}/env?teamId=${teamId}&decrypt=false`);
    const envNames = (variables.envs ?? []).map((e) => ({
      key: e.key,
      targets: e.target,
      gitBranch: e.gitBranch ?? null,
    }));
    const mfa = [];
    for (const env of (variables.envs ?? []).filter((e) => e.key === 'AFHOMES_REQUIRE_ADMIN_MFA')) {
      const detail = get(`/v1/projects/${projectId}/env/${env.id}?teamId=${teamId}`);
      assert.equal(
        detail.value,
        'false',
        'MFA configuration does not match approved optional policy',
      );
      mfa.push({ required: false, targets: env.target, gitBranch: env.gitBranch ?? null });
    }
    const mapping = [];
    for (const env of (variables.envs ?? []).filter((e) =>
      ['SUPABASE_URL', 'VITE_SUPABASE_URL'].includes(e.key),
    )) {
      const detail = get(`/v1/projects/${projectId}/env/${env.id}?teamId=${teamId}`);
      assert.equal(
        new URL(detail.value).hostname,
        'ikaevepedpqygdlipsei.supabase.co',
        'Supabase mapping mismatch',
      );
      mapping.push({ key: env.key, targets: env.target, matchesApprovedProject: true });
    }
    assert(
      envNames.some(
        (e) => e.key === 'SUPABASE_SERVICE_ROLE_KEY' && e.targets.includes('production'),
      ),
    );
    assert(mapping.some((e) => e.key === 'SUPABASE_URL' && e.targets.includes('production')));
    const keys = Array.isArray(deployment.env) ? deployment.env : Object.keys(deployment.env ?? {});
    const evidence = {
      observedAt: new Date().toISOString(),
      readOnly: true,
      cliVersion,
      authenticatedUser,
      project: {
        id: project.id,
        name: project.name,
        accountId: project.accountId,
        productionBranch: project.link?.productionBranch,
      },
      currentProduction: summarize(deployment),
      newestProductionHistory: history.deployments?.map(summarize),
      environmentNames: envNames,
      mfaFlagAbsent: mfa.length === 0,
      mfa,
      deploymentEnvironmentMetadataAvailable: keys.length > 0,
      deploymentMfaKeyPresent: keys.includes('AFHOMES_REQUIRE_ADMIN_MFA'),
      supabaseMapping: mapping,
    };
    fs.writeFileSync(
      'docs/security/evidence/checkpoint-vercel-verification.json',
      JSON.stringify(evidence, null, 2) + '\n',
    );
    console.log(JSON.stringify(evidence, null, 2));
  }
} catch (error) {
  console.error(
    JSON.stringify({
      exitCode: error.exitCode ?? 1,
      ...(error.diagnostic ?? {
        category: 'PREFLIGHT_ASSERTION',
        message: 'Required project, deployment, or configuration assertion failed.',
      }),
    }),
  );
  process.exitCode = error.exitCode ?? 1;
}
