/** MongoDB development SPAs/API. Never bootstraps, seeds or initializes commercial schema. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { createMongoClient } from '../_lib/mongodb.js';
import { createMongoPhase5Runtime } from '../_lib/mongo-runtime.js';
import { getAuthOptions } from '../_lib/auth.js';
import { createMongoDevelopmentHandler } from '../_lib/mongo-development-access.js';
import { inspectMongoCoreSetup } from '../_lib/mongo-core-setup.js';
import { createDevelopmentPrivateObjectStore } from '../_lib/private-object-store.js';
import { createMongoSearchMaintenance } from '../_lib/search-maintenance.mongo.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const frontends: ChildProcess[] = [];
let api: http.Server | undefined;
let client: ReturnType<typeof createMongoClient>['client'] | undefined;
let closing = false;
let maintenance: ReturnType<typeof createMongoSearchMaintenance> | undefined;
let startupStage = 'configuration';
async function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const frontend of frontends) frontend.kill();
  api?.closeAllConnections();
  if (api?.listening) await new Promise<void>((resolve) => api!.close(() => resolve()));
  await maintenance?.stop();
  await client?.close();
  process.exit(code);
}
try {
  loadEnvFile(path.join(root, '.env.local'));
  const adminBase = new URL(process.env.VITE_ADMIN_URL ?? 'http://localhost:5184/admin').origin;
  const webBase = new URL(process.env.VITE_WEB_URL ?? 'http://localhost:5183').origin;
  const apiBase = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3084').origin;
  if (
    [adminBase, webBase, apiBase].some((base) => {
      const url = new URL(base);
      return url.hostname !== 'localhost' || url.protocol !== 'http:' || Number(url.port) < 1024;
    })
  )
    throw new Error('Development URLs must be explicit localhost ports');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    BETTER_AUTH_URL: apiBase,
    AFHOMES_AUTH_TRUSTED_ORIGINS: `${adminBase},${webBase}`,
  };
  getAuthOptions(env);
  const connection = createMongoClient(env);
  startupStage = 'connection';
  client = connection.client;
  await client.connect();
  const db = client.db(connection.database);
  await db.command({ ping: 1 });
  const coreWritesEnabled = env.AFHOMES_MONGODB_ENABLE_CORE_WRITES === 'true';
  const objects = createDevelopmentPrivateObjectStore(env, apiBase);
  if (coreWritesEnabled) {
    startupStage = 'approved core initialization and private storage';
    const readiness = await inspectMongoCoreSetup(db);
    if (!readiness.initialized || readiness.missingRoles.length || readiness.missingDepartments.length || readiness.missingModules.length || !objects)
      throw new Error('Core setup and private object storage are required before enabling writes');
    maintenance = createMongoSearchMaintenance(db,client);
    await maintenance.start();
  }
  const runtime = createMongoPhase5Runtime(db, client, env, {}, objects);
  api = http.createServer(createMongoDevelopmentHandler(runtime,{coreWritesEnabled}));
  startupStage = 'localhost listeners';
  await new Promise<void>((resolve, reject) => {
    api!.once('error', reject);
    api!.listen(Number(new URL(apiBase).port), 'localhost', resolve);
  });
  fs.mkdirSync(path.join(root, '.tmp-bin'), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(root, '.tmp-bin/mongodb-admin-env-'));
  const childEnv = { ...process.env };
  // The browser process receives only its required public configuration, never server credentials.
  for (const key of Object.keys(childEnv))
    if (key.startsWith('VITE_') || /^(MONGODB_|BETTER_AUTH_|SUPABASE_|AFHOMES_)/.test(key))
      delete childEnv[key];
  Object.assign(childEnv, {
    AFHOMES_DEV_ENV_DIR: temporary,
    AFHOMES_DEV_API_TARGET: apiBase,
    VITE_AUTH_PROVIDER: 'mongodb',
    VITE_API_BASE_URL: '/api/v1',
    VITE_ADMIN_URL: `${adminBase}/admin`,
    VITE_WEB_URL: webBase,
  });
  for (const [name, base] of [
    ['admin', adminBase],
    ['web', webBase],
  ]) {
    const cwd = path.join(root, 'apps', name!),
      require = createRequire(path.join(cwd, 'package.json'));
    const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    const frontend = spawn(
      process.execPath,
      [vite, '--host', 'localhost', '--port', new URL(base!).port, '--strictPort'],
      { cwd, env: childEnv, stdio: 'inherit', windowsHide: true },
    );
    frontends.push(frontend);
    frontend.on('exit', (code) => {
      if (!closing) void close(code ?? 1);
    });
    frontend.on('error', () => {
      console.error('MongoDB localhost frontend could not start.');
      void close(1);
    });
  }
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());
  console.log(`[mongodb] Admin: ${adminBase}/admin/login | Web: ${webBase}`);
  console.log(
    !env.AFHOMES_PRIVATE_STORAGE_PROVIDER || env.AFHOMES_PRIVATE_STORAGE_PROVIDER === 'local'
      ? '[mongodb] Private files: persistent local storage in your home folder under .afhomes/private-storage/afhomes_dev. No cloud bucket required.'
      : '[mongodb] Private files: configured S3-compatible bucket.',
  );
  console.log(
    coreWritesEnabled
      ? '[mongodb] Connected to afhomes_dev. Approved native core workflows and search retention worker enabled. No startup seeds, bootstrap or Supabase fallback.'
      : '[mongodb] Connected to afhomes_dev. Converted reads and account settings enabled; business writes remain off. No seeds, bootstrap or Supabase fallback.',
  );
} catch {
  console.error(
    `MongoDB localhost could not start at ${startupStage}. Check server configuration and approved initialization. No credentials or raw errors are printed.`,
  );
  await close(1);
}
