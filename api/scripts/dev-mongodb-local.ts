/** Fresh synthetic local Phase 5 runtime. Never reads .env.local or connects to Atlas. */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { LocalPrivateObjectStore } from '../_lib/private-object-store.js';
import { createTestReplica } from '../_lib/testing/mongo-replica.js';
import { seedPhase7Fixture } from '../_lib/testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from '../_lib/mongo-runtime.js';
import { createMongoSearchMaintenance } from '../_lib/search-maintenance.mongo.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tempRoot = path.join(root, '.tmp-bin');
fs.mkdirSync(tempRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempRoot, 'phase5-browser-'));
const emptyEnv = path.join(temp, 'env');
fs.mkdirSync(emptyEnv);
const children: ChildProcess[] = [];
const replica = await createTestReplica();
const api = http.createServer();
async function port() {
  const socket = http.createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const value = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return value;
}
await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
// A separate hostname keeps disposable QA cookies away from the real localhost session.
const apiBase = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
const adminBase = `http://127.0.0.1:${await port()}`,
  webBase = `http://127.0.0.1:${await port()}`;
const env = {
  NODE_ENV: 'development',
  BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
  BETTER_AUTH_URL: apiBase,
  AFHOMES_AUTH_TRUSTED_ORIGINS: `${adminBase},${webBase}`,
  AFHOMES_WEB_URL: webBase,
  MONGODB_URI: 'mongodb://127.0.0.1',
  AFHOMES_SEARCH_LOCAL_PREVIEW: 'true',
  AFHOMES_SEARCH_ENABLED: 'true',
  AFHOMES_SEARCH_SECRET: randomBytes(48).toString('base64url'),
  AFHOMES_SEARCH_TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
  VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  // Cloudflare's documented dummy keys can return example.com from Siteverify.
  AFHOMES_SEARCH_TURNSTILE_HOSTNAMES: '127.0.0.1,example.com',
  AFHOMES_SEARCH_CONTACT_RETENTION_DAYS: '1',
  AFHOMES_VERIFICATION_PHONE: '+639170000000',
};
// Fictional disposable QA password only; never a default for business provisioning.
await seedPhase7Fixture(replica.db, replica.client, env, 'SyntheticLocalOnly123');
const maintenance = createMongoSearchMaintenance(replica.db, replica.client);
await maintenance.start();
const objectPrefix = path.join(os.tmpdir(), 'afhomes-private-objects-');
const objectRoot = fs.mkdtempSync(objectPrefix);
const objects = new LocalPrivateObjectStore({
  root: objectRoot,
  baseURL: apiBase,
  secret: randomBytes(48).toString('base64url'),
});
api.on('request', createMongoPhase5Runtime(replica.db, replica.client, env, {}, objects));
for (const [name, base] of [
  ['admin', adminBase],
  ['web', webBase],
]) {
  const cwd = path.join(root, 'apps', name!);
  const require = createRequire(path.join(cwd, 'package.json'));
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv))
    if (key.startsWith('VITE_') || /^(MONGODB_|BETTER_AUTH_|SUPABASE_|AFHOMES_)/.test(key))
      delete childEnv[key];
  Object.assign(childEnv, {
    AFHOMES_DEV_ENV_DIR: emptyEnv,
    AFHOMES_DEV_API_TARGET: apiBase,
    VITE_AUTH_PROVIDER: 'mongodb',
    VITE_API_BASE_URL: '/api/v1',
    VITE_ADMIN_URL: `${adminBase}/admin`,
    VITE_WEB_URL: webBase,
  });
  children.push(
    spawn(
      process.execPath,
      [vite, '--host', '127.0.0.1', '--port', new URL(base!).port, '--strictPort'],
      { cwd, env: childEnv, stdio: 'inherit', windowsHide: true },
    ),
  );
}
fs.writeFileSync(path.join(temp, 'targets.json'), JSON.stringify({ apiBase, adminBase, webBase }));
console.log(`[phase5-local] admin=${adminBase}/staff/login web=${webBase}/customer/login`);
console.log(
  '[phase5-local] Fresh synthetic database only. Existing admin and Atlas remain untouched.',
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  api.closeAllConnections();
  await new Promise<void>((resolve) => api.close(() => resolve()));
  await maintenance.stop();
  await replica.stop();
  if (!path.resolve(objectRoot).startsWith(path.resolve(objectPrefix)))
    throw new Error('Invalid disposable object directory');
  fs.rmSync(objectRoot, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
for (const child of children)
  child.on('exit', () => {
    if (!closing) void close();
  });
