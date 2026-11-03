import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createHostedMongoHandler } from './hosted-runtime.js';
import { createHostedPrivateObjectStore } from './private-object-store.js';
import type { MongoRow } from './customer-activation.mongo.js';

it.each([
  { name: 'baseline', customers: 1, requests: 240, concurrency: 8 },
  { name: '10000-customer production-mode workload', customers: 10000, requests: 2400, concurrency: 20 },
])('$name: concurrent reads/downloads preserve authorization', async (profile) => {
  const replica = await createTestReplica({ timeoutMS: 15_000 });
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-runtime-load-'));
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('afhomes-runtime-load-')) {
    await replica.stop();
    throw new Error('Unexpected test directory');
  }
  const env = {
    NODE_ENV: 'production', AFHOMES_HOSTED_RUNTIME_ENABLED: 'true', MONGODB_DB: 'afhomes_dev',
    AFHOMES_PUBLIC_ORIGIN: 'https://load.example.invalid', BETTER_AUTH_URL: 'https://load.example.invalid',
    AFHOMES_WEB_URL: 'https://load.example.invalid', AFHOMES_ADMIN_URL: 'https://load.example.invalid/admin',
    BETTER_AUTH_SECRET: 'synthetic-disposable-load-only'.repeat(3),
    AFHOMES_PRIVATE_STORAGE_PROVIDER: 'filesystem', AFHOMES_PRIVATE_STORAGE_ROOT: root,
  };
  const server = http.createServer(createHostedMongoHandler(replica.db, replica.client, env));
  try {
    const fixture = await seedPhase7Fixture(replica.db, replica.client, env, 'SyntheticLoad123!');
    const col = (name: string) => replica.db.collection<MongoRow>(name);
    if (profile.customers > 1) {
      const source = await col('customers').findOne({ _id: fixture.customer.id });
      expect(source).not.toBeNull();
      await col('customers').insertMany(Array.from({ length: profile.customers - 1 }, (_, i) => ({
        ...source!, _id: randomUUID(), customer_number: `SYNTHETIC-LOAD-${i}`,
        customer_code: `AF-CC-${String(i).padStart(8, '0')}`, ra_number: `2026-${i + 10000}`,
        email: `synthetic-load-${i}@example.invalid`, first_name: 'Synthetic', last_name: `Load ${i}`,
      })));
    }
    expect(await col('customers').countDocuments()).toBe(profile.customers);
    await col('staff_users').updateOne({ _id: fixture.staff.id }, { $set: { must_change_password: false } });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const request = (route: string, cookie = '', body?: object) => new Promise<{ status: number; cookies: string[]; ms: number; bytes: number; cache: string }>((resolve, reject) => {
      const start = performance.now();
      const req = http.request({ hostname: '127.0.0.1', port, path: route, method: body ? 'POST' : 'GET', headers: {
        Host: 'load.example.invalid', 'X-Forwarded-Proto': 'https', Origin: env.AFHOMES_PUBLIC_ORIGIN,
        'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
      } }, res => {
        let bytes = 0;
        res.on('data', chunk => { bytes += chunk.length; });
        res.once('error', reject);
        res.once('end', () => resolve({ status: res.statusCode!, cookies: res.headers['set-cookie'] ?? [], ms: performance.now() - start, bytes, cache: String(res.headers['cache-control'] ?? '') }));
      });
      req.setTimeout(15_000, () => req.destroy(new Error('Synthetic load request timed out')));
      req.once('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
    const login = await request('/api/v1/auth/identity/sign-in/email', '', { email: fixture.staff.email, password: 'SyntheticLoad123!' });
    expect(login.status).toBe(200);
    const cookie = login.cookies.map(value => value.split(';')[0]).join('; ');
    const bytes = Buffer.alloc(256 * 1024, 42);
    const objects = createHostedPrivateObjectStore(env);
    await objects.put('load/synthetic.bin', bytes, 'application/octet-stream');
    const grant = new URL((await objects.downloadURL('load/synthetic.bin', 120)).url);
    const download = grant.pathname + grant.search;
    expect((await request('/api/v1/members', cookie)).status).toBe(403);
    const routes = ['/api/v1/admin/afhomes/session', '/api/v1/card-products', '/api/v1/card-categories', '/api/v1/customers', download];
    for (const [index, route] of routes.entries()) expect((await request(route, cookie)).status, `preflight route ${index}`).toBe(200);
    const results: Awaited<ReturnType<typeof request>>[] = [];
    let next = 0;
    const start = performance.now();
    const workers = await Promise.allSettled(Array.from({ length: profile.concurrency }, async () => {
      while (next < profile.requests) {
        const index = next++;
        const result = await request(routes[index % routes.length]!, cookie);
        expect(result.status, `workload route ${index % routes.length}`).toBe(200);
        expect(result.cache).toContain('no-store');
        if (index % routes.length === 4) expect(result.bytes).toBe(bytes.length);
        results.push(result);
      }
    }));
    const failures = workers.flatMap(worker => worker.status === 'rejected'
      ? [worker.reason instanceof Error ? worker.reason.message : 'Request rejected'] : []);
    expect(failures).toEqual([]);
    const duration = performance.now() - start;
    expect(results).toHaveLength(profile.requests);
    const module = await col('modules').findOne({ key: 'sales.customers' });
    expect(module).not.toBeNull();
    const denyId = randomUUID();
    await col('staff_permission_restrictions').insertOne({ _id: denyId, staff_id: fixture.staff.id, module_id: module!._id, deny_view: true });
    expect((await request('/api/v1/customers', cookie)).status).toBe(403);
    await col('staff_permission_restrictions').deleteOne({ _id: denyId });
    expect((await request('/api/v1/customers', cookie)).status).toBe(200);
    await col('staff_users').updateOne({ _id: fixture.staff.id }, { $set: { status: 'suspended' } });
    expect((await request('/api/v1/customers', cookie)).status).toBe(403);
    const latencies = results.map(result => result.ms).sort((a, b) => a - b);
    process.stdout.write('Disposable hosted load: ' + JSON.stringify({ profile: profile.name, customers: profile.customers, requests: results.length, concurrency: profile.concurrency, failures: 0, privateDownloads: profile.requests / routes.length, privateBytesEach: bytes.length, p50Ms: +latencies[Math.ceil(results.length * 0.5) - 1]!.toFixed(2), p95Ms: +latencies[Math.ceil(results.length * 0.95) - 1]!.toFixed(2), maximumMs: +latencies.at(-1)!.toFixed(2), requestsPerSecond: +(profile.requests * 1000 / duration).toFixed(2), immediateDenyAndRestore: true, suspendedUserDenied: true, sharedDatabase: false }) + '\n');
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await replica.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
