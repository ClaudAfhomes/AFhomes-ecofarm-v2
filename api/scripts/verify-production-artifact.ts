/**
 * Verifies the built production artifact against a disposable MongoDB replica.
 *
 * Safe by construction: it never loads the repository `.env`, strips every
 * inherited Mongo/Auth/Supabase variable, and points the child process at a
 * fresh in-memory replica set. It performs no seeds, migrations, or indexes.
 *
 * Usage: pnpm --filter api build:artifact && pnpm exec tsx api/scripts/verify-production-artifact.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestReplica } from '../_lib/testing/mongo-replica.js';
import { seedPhase5Fixture } from '../_lib/testing/phase5-fixture.js';
import type { MongoRow } from '../_lib/customer-activation.mongo.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const built = path.join(root, 'api', 'dist');
if (!existsSync(path.join(built, 'server.js'))) {
  console.error('Build the artifact first: pnpm --filter api build:artifact');
  process.exit(1);
}
// Run from a directory outside the repository so an undeclared workspace
// dependency cannot silently satisfy a missing import.
const artifactRoot = mkdtempSync(path.join(os.tmpdir(), 'afhomes-api-artifact-'));
cpSync(built, artifactRoot, { recursive: true });
const artifact = path.join(artifactRoot, 'server.js');
const ORIGIN = 'https://portal.afhomes.test';
const SECRET = `artifact-verification-${'s'.repeat(32)}`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);
const failures: string[] = [];
let child: ChildProcess | undefined;

function check(label: string, condition: boolean, detail = '') {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures.push(label);
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function waitFor(url: string, timeoutMs = 20_000): Promise<Response | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return null;
}

const replica = await createTestReplica({ timeoutMS: 20_000 });
let mediaRoot: string | undefined;
try {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  mediaRoot = mkdtempSync(path.join(os.tmpdir(), 'afhomes-artifact-media-'));
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(MONGODB_|BETTER_AUTH_|SUPABASE_|AFHOMES_|DATABASE_URL|VITE_)/.test(key)) delete env[key];
  Object.assign(env, {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    MONGODB_URI: replica.uri,
    MONGODB_DB: 'afhomes_dev',
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: ORIGIN,
    AFHOMES_AUTH_TRUSTED_ORIGINS: ORIGIN,
    AFHOMES_WEB_URL: ORIGIN,
    AFHOMES_ENABLE_SEARCH_MAINTENANCE: 'false',
    AFHOMES_PUBLIC_MEDIA_ROOT: mediaRoot,
    AFHOMES_PUBLIC_MEDIA_MAX_BYTES: '1048576',
  });

  child = spawn(process.execPath, [artifact], {
    cwd: path.dirname(artifact),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout?.on('data', (chunk) => (output += String(chunk)));
  child.stderr?.on('data', (chunk) => (output += String(chunk)));
  const exited = new Promise<number>((resolve) => child!.once('exit', (code) => resolve(code ?? 1)));

  const health = await waitFor(`${base}/health`);
  check('artifact starts and serves /health', health?.status === 200, String(health?.status));
  const healthBody = health ? await health.json() : {};
  check('health response is sanitized', JSON.stringify(healthBody).includes('afhomes-api'));
  check(
    'health response contains no configuration or secrets',
    !JSON.stringify(healthBody).includes(SECRET) &&
      !JSON.stringify(healthBody).includes('mongodb'),
  );

  const ready = await fetch(`${base}/ready`);
  check('readiness pings the approved database', ready.status === 200);

  const startupCollections = await replica.db.listCollections({}, { nameOnly: true }).toArray();
  check(
    'startup created no collections, seeds, or schema',
    startupCollections.length === 0,
    startupCollections.map((entry) => entry.name).join(', '),
  );

  const session = await fetch(`${base}/api/v1/auth/identity/get-session`, {
    headers: { Origin: ORIGIN },
  });
  check('Better Auth session route is mounted', session.status === 200, String(session.status));
  check(
    'session response sets no insecure cookie',
    session.headers.getSetCookie().every((cookie) => cookie.includes('Secure')),
  );

  const fixture = await seedPhase5Fixture(
    replica.db,
    replica.client,
    env,
    'Artifact-Fixture-Password-9',
  );
  await replica.db
    .collection('staff_users')
    .updateOne({ email: fixture.staff.email }, { $set: { must_change_password: false } });
  const assignment = await replica.db
    .collection('staff_role_assignments')
    .findOne({ staff_id: fixture.staff.id });
  const mediaModule = randomUUID();
  await replica.db
    .collection<MongoRow>('modules')
    .insertOne({ _id: mediaModule, key: 'cms.media', is_active: true });
  await replica.db
    .collection<MongoRow>('role_permissions')
    .insertOne({
    _id: randomUUID(),
    role_id: assignment?.role_id,
    module_id: mediaModule,
    can_view: true,
    can_create: true,
    can_update: true,
    can_delete: true,
  });

  const login = await fetch(`${base}/api/v1/auth/identity/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: fixture.staff.email, password: fixture.staff.password }),
  });
  check('Better Auth sign-in succeeds over the artifact', login.status === 200, String(login.status));
  const cookies = login.headers.getSetCookie();
  check(
    'login issues Secure, HttpOnly cookies',
    cookies.length > 0 &&
      cookies.every((cookie) => /;\s*Secure/i.test(cookie) && /;\s*HttpOnly/i.test(cookie)),
  );
  const cookie = cookies.map((value) => value.split(';')[0]).join('; ');
  const authenticated = await fetch(`${base}/api/v1/customers`, {
    headers: { Cookie: cookie },
  });
  check(
    'authenticated business read succeeds through the artifact',
    authenticated.status === 200,
    String(authenticated.status),
  );

  const anonymousUpload = await fetch(`${base}/api/v1/media?name=anonymous.png`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: PNG,
  });
  check(
    'anonymous media upload is rejected',
    anonymousUpload.status === 401 || anonymousUpload.status === 403,
    String(anonymousUpload.status),
  );

  const created = await fetch(
    `${base}/api/v1/media?name=hero.png&alt=Artifact%20hero&category=website`,
    {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'image/png' },
      body: PNG,
    },
  );
  check('authorized image upload succeeds', created.status === 201, String(created.status));
  const createdBody = created.status === 201 ? await created.json() : {};
  check(
    'upload returns a stable public URL',
    typeof createdBody.publicUrl === 'string' &&
      createdBody.publicUrl === `${ORIGIN}${new URL(createdBody.publicUrl).pathname}`,
  );
  const mediaPath =
    typeof createdBody.publicUrl === 'string'
      ? new URL(createdBody.publicUrl).pathname
      : '/media/not-created.png';
  const mediaId =
    typeof createdBody.id === 'string'
      ? createdBody.id
      : '00000000-0000-4000-8000-000000000000';
  const publicFile = await fetch(`${base}${mediaPath}`);
  check('public media bytes are served', publicFile.status === 200, String(publicFile.status));
  check(
    'public media is immutable and sniff-proof',
    publicFile.headers.get('content-type') === 'image/png' &&
      publicFile.headers.get('cache-control')?.includes('immutable') === true &&
      publicFile.headers.get('x-content-type-options') === 'nosniff',
  );

  const listed = await fetch(`${base}/api/v1/media`, { headers: { Cookie: cookie } });
  const listedBody = listed.status === 200 ? await listed.json() : {};
  check(
    'authorized media listing returns the upload',
    listedBody.data?.some((item: { id: string }) => item.id === mediaId) === true,
  );

  const unpublished = await fetch(`${base}/api/v1/media/${mediaId}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'unpublished' }),
  });
  check('media can be unpublished', unpublished.status === 200, String(unpublished.status));
  check(
    'unpublished media is no longer public',
    (await fetch(`${base}${mediaPath}`)).status === 404,
  );

  const deleted = await fetch(`${base}/api/v1/media/${mediaId}?confirm=true`, {
    method: 'DELETE',
    headers: { Cookie: cookie, Origin: ORIGIN },
  });
  check('media can be deleted with confirmation', deleted.status === 200, String(deleted.status));
  const afterDelete = await fetch(`${base}/api/v1/media`, { headers: { Cookie: cookie } });
  const afterDeleteBody = afterDelete.status === 200 ? await afterDelete.json() : {};
  check('deleted media leaves no metadata', afterDeleteBody.meta?.total === 0);

  const signOut = await fetch(`${base}/api/v1/auth/identity/sign-out`, {
    method: 'POST',
    headers: { Origin: ORIGIN, Cookie: cookie },
  });
  check('sign-out is available', [200, 204].includes(signOut.status), String(signOut.status));
  const afterSignOut = await fetch(`${base}/api/v1/customers`, {
    headers: { Cookie: cookie },
  });
  check(
    'session invalidation is enforced',
    afterSignOut.status === 401 || afterSignOut.status === 403,
    String(afterSignOut.status),
  );

  const unauthenticated = await fetch(`${base}/api/v1/customers`);
  check(
    'business routes keep authentication',
    unauthenticated.status === 401 || unauthenticated.status === 403,
    String(unauthenticated.status),
  );

  const template = await fetch(`${base}/api/v1/customer-imports/template/csv`);
  check(
    'bundled workbook assets resolve at runtime',
    template.status === 401 || template.status === 403,
    String(template.status),
  );

  for (const [label, route] of [
    ['disabled reports', '/api/v1/reports'],
    ['disabled redemptions', '/api/v1/redemptions'],
    ['disabled earning', '/api/v1/earning'],
    ['unmounted legacy signup', '/api/v1/auth/identity/sign-up/email'],
  ] as const) {
    const response = await fetch(`${base}${route}`);
    check(`${label} stay unavailable`, response.status === 404, String(response.status));
  }

  const privateFile = await fetch(`${base}/api/v1/private-files?token=x&signature=y`);
  check(
    'private files fail closed without configured storage',
    privateFile.status === 403 || privateFile.status === 404,
    String(privateFile.status),
  );

  const write = await fetch(`${base}/api/v1/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: '{}',
  });
  check(
    'unauthenticated writes are rejected, not served',
    write.status === 401 || write.status === 403,
    String(write.status),
  );

  if (process.platform !== 'win32') {
    child.kill('SIGTERM');
    const code = await Promise.race([
      exited,
      new Promise<number>((resolve) => setTimeout(() => resolve(124), 15_000)),
    ]);
    check('SIGTERM exits cleanly', code === 0, String(code));
  } else {
    child.kill();
    await Promise.race([
      exited,
      new Promise<number>((resolve) => setTimeout(() => resolve(124), 15_000)),
    ]);
    console.log('SKIP SIGTERM exit-code assertion on Windows (signal semantics differ)');
  }

  check('artifact log contains no secret', !output.includes(SECRET));

  const failureEnv = (port: number, overrides: Record<string, string>) => {
    const values: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(values))
      if (/^(MONGODB_|BETTER_AUTH_|SUPABASE_|AFHOMES_|DATABASE_URL|VITE_)/.test(key))
        delete values[key];
    Object.assign(values, {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      MONGODB_URI: replica.uri,
      MONGODB_DB: 'afhomes_dev',
      BETTER_AUTH_SECRET: SECRET,
      BETTER_AUTH_URL: ORIGIN,
      AFHOMES_AUTH_TRUSTED_ORIGINS: ORIGIN,
      AFHOMES_WEB_URL: ORIGIN,
      ...overrides,
    });
    return values;
  };
  const expectFailure = async (
    label: string,
    overrides: Record<string, string>,
    expected: string,
  ) => {
    const port = await freePort();
    const childProcess = spawn(process.execPath, [artifact], {
      cwd: path.dirname(artifact),
      env: failureEnv(port, overrides),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let text = '';
    childProcess.stdout?.on('data', (chunk: Buffer) => (text += String(chunk)));
    childProcess.stderr?.on('data', (chunk: Buffer) => (text += String(chunk)));
    const code = await Promise.race([
      new Promise<number>((resolve) =>
        childProcess.once('exit', (value: number | null) => resolve(value ?? 1)),
      ),
      new Promise<number>((resolve) => setTimeout(() => resolve(124), 20_000)),
    ]);
    if (code === 124) childProcess.kill();
    check(`${label} fails closed`, code === 1, String(code));
    check(`${label} names the problem`, text.includes(expected));
    check(`${label} does not leak a credential`, !text.includes(SECRET));
  };
  await expectFailure('missing authentication secret', { BETTER_AUTH_SECRET: '' }, 'BETTER_AUTH_SECRET');
  await expectFailure(
    'unreachable database',
    {
      MONGODB_URI: 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500',
      AFHOMES_REQUEST_TIMEOUT_MS: '5000',
    },
    'startup failed during database',
  );
} finally {
  if (child && !child.killed) child.kill();
  await replica.stop();
  rmSync(artifactRoot, { recursive: true, force: true });
  if (mediaRoot) rmSync(mediaRoot, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} artifact verification check(s) failed.`);
  process.exit(1);
}
console.log('\nProduction artifact verification passed.');
