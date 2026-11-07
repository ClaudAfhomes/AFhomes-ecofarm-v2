// Disposable local preview: real PostgreSQL + PostgREST, synthetic sellers, Cloudflare Turnstile test keys.
// Requires Docker with the existing postgres:18-alpine and postgrest/postgrest:v14.17 images.
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import pg from 'pg';
import { listMigrations } from './lib/local-postgres.mjs';
import { seedSearchOst } from './lib/sale-team-search-fixture.mjs';

const dbPort = 55451,
  restPort = 55452,
  gatewayPort = 55453,
  apiPort = 3001,
  webPort = 5183;
for (const port of [dbPort, restPort, gatewayPort, apiPort, webPort]) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
}
const password = randomBytes(24).toString('hex');
const jwtSecret = randomBytes(32).toString('hex');
const dbName = `afhomes-search-preview-db-${process.pid}`,
  restName = `afhomes-search-preview-rest-${process.pid}`;
const containers = [],
  children = [];
let client, gateway;
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const jwt = (role) => {
  const a = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const b = Buffer.from(
    JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 86400 }),
  ).toString('base64url');
  return `${a}.${b}.${createHmac('sha256', jwtSecret).update(`${a}.${b}`).digest('base64url')}`;
};
const delay = () => new Promise((resolve) => setTimeout(resolve, 250));
async function waitFor(check) {
  for (let i = 0; i < 120; i++) {
    try {
      if (await check()) return;
    } catch {
      /* starting */
    }
    await delay();
  }
  throw new Error('Local preview dependency did not become ready');
}
async function stop() {
  for (const child of children) child.kill();
  gateway?.close();
  await client?.end().catch(() => {});
  for (const name of containers.reverse()) {
    try {
      docker(['stop', name]);
    } catch {
      /* already stopped */
    }
  }
}
try {
  const databaseUri = new URL(`postgres://host.docker.internal:${dbPort}/postgres`);
  databaseUri.username = 'afhomes';
  databaseUri.password = password;
  docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    dbName,
    '--publish',
    `127.0.0.1:${dbPort}:5432`,
    '--env',
    'POSTGRES_USER=afhomes',
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    'postgres:18-alpine',
  ]);
  containers.push(dbName);
  await waitFor(async () => {
    const probe = new pg.Client({
      host: '127.0.0.1',
      port: dbPort,
      user: 'afhomes',
      password,
      database: 'postgres',
    });
    try {
      await probe.connect();
      await probe.end();
      return true;
    } catch {
      await probe.end().catch(() => {});
      return false;
    }
  });
  client = new pg.Client({
    host: '127.0.0.1',
    port: dbPort,
    user: 'afhomes',
    password,
    database: 'postgres',
  });
  client.on('error', () => {});
  await client.connect();
  if ((await client.query('select host(inet_server_addr()) host')).rows[0].host === null)
    throw new Error('Expected TCP database');
  await client.query(fs.readFileSync('supabase/db-testing/supabase-shim.sql', 'utf8'));
  for (const file of listMigrations())
    await client.query(
      fs.readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/^\uFEFF/, ''),
    );
  // Managed Supabase gives its service role foundation reads; the SQL shim omits that platform default.
  await client.query(
    'grant select on public.modules,public.roles,public.departments,public.staff_users to service_role',
  );
  const seller = randomUUID();
  await client.query('insert into auth.users(id,email) values($1,$2)', [
    seller,
    'synthetic-seller@example.invalid',
  ]);
  await client.query(
    "insert into public.staff_users(id,email,full_name,status) values($1,'synthetic-seller@example.invalid','Synthetic Seller','active')",
    [seller],
  );
  await client.query(
    "insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='sales_manager'",
    [seller],
  );
  await client.query(
    "insert into private.sale_team_accreditations(staff_id,aa_number,public_name,kind,status,approved_by) values($1,'AAI26100001','Synthetic Seller','IST','active',$1)",
    [seller],
  );
  await seedSearchOst(client, seller);
  docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    restName,
    '--publish',
    `127.0.0.1:${restPort}:3000`,
    '--env',
    `PGRST_DB_URI=${databaseUri.href}`,
    '--env',
    'PGRST_DB_SCHEMAS=public',
    '--env',
    'PGRST_DB_ANON_ROLE=anon',
    '--env',
    `PGRST_JWT_SECRET=${jwtSecret}`,
    'postgrest/postgrest:v14.17',
  ]);
  containers.push(restName);
  await waitFor(async () => (await fetch(`http://127.0.0.1:${restPort}/`)).ok);
  gateway = http.createServer(async (req, res) => {
    if (!req.url?.startsWith('/rest/v1/')) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const body = Buffer.concat(chunks);
      const headers = { ...req.headers };
      delete headers.host;
      delete headers['content-length'];
      const upstream = await fetch(
        `http://127.0.0.1:${restPort}${req.url.slice('/rest/v1'.length)}`,
        { method: req.method, headers, ...(body.length ? { body } : {}) },
      );
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      });
      res.end(await upstream.text());
    } catch {
      res.writeHead(503);
      res.end();
    }
  });
  await new Promise((resolve) => gateway.listen(gatewayPort, '127.0.0.1', resolve));
  const env = {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${gatewayPort}`,
    VITE_SUPABASE_URL: `http://127.0.0.1:${gatewayPort}`,
    SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'),
    SUPABASE_PUBLISHABLE_KEY: jwt('anon'),
    VITE_SUPABASE_PUBLISHABLE_KEY: jwt('anon'),
    DATABASE_URL: '',
    AFHOMES_SEARCH_ENABLED: 'true',
    AFHOMES_SEARCH_LOCAL_PREVIEW: 'true',
    AFHOMES_SEARCH_SECRET: randomBytes(32).toString('hex'),
    AFHOMES_SEARCH_TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    AFHOMES_SEARCH_TURNSTILE_HOSTNAMES: 'localhost,127.0.0.1,example.com',
    AFHOMES_VERIFICATION_PHONE: '+63 960-431-6867',
    AFHOMES_SEARCH_CONTACT_RETENTION_DAYS: '1',
    AFHOMES_DEV_HOST: '127.0.0.1',
    AFHOMES_DEV_API_TARGET: `http://127.0.0.1:${apiPort}`,
    VITE_WEB_URL: `http://localhost:${webPort}`,
    AFHOMES_WEB_URL: `http://localhost:${webPort}`,
  };
  children.push(
    spawn(process.execPath, ['--import', 'tsx', 'api/dev-server.ts', String(apiPort)], {
      env,
      stdio: 'inherit',
      windowsHide: true,
    }),
  );
  children.push(
    spawn(
      process.execPath,
      [
        path.resolve('apps/web/node_modules/vite/bin/vite.js'),
        '--port',
        String(webPort),
        '--strictPort',
      ],
      { cwd: path.resolve('apps/web'), env, stdio: 'inherit', windowsHide: true },
    ),
  );
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${apiPort}/api/v1/sale-team/search/config`)).ok,
  );
  const timer = setInterval(
    () => void client.query('select public.cleanup_sale_team_search(1)').catch(() => {}),
    60000,
  );
  console.log(
    `LOCAL PREVIEW: http://localhost:${webPort}/sale-team-search — synthetic IST AAI26100001 / OST AAO26100001. Draft notice; Cloudflare Turnstile test keys; disposable data only.`,
  );
  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (line) => {
      if (line.trim() === 'stop') resolve();
    });
    for (const child of children) child.once('exit', resolve);
  });
  clearInterval(timer);
} finally {
  await stop();
}
