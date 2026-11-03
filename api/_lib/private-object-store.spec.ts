import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createDevelopmentPrivateObjectStore, createS3PrivateObjectStore, LocalPrivateObjectStore } from './private-object-store.js';
import { createMongoDevelopmentHandler } from './mongo-development-access.js';

it('selects local storage only in the development launcher with an authenticated loopback configuration', () => {
  const env = { NODE_ENV: 'development', MONGODB_DB: 'afhomes_dev', BETTER_AUTH_SECRET: 'synthetic'.repeat(8) };
  expect(createDevelopmentPrivateObjectStore(env, 'http://localhost:3084')).toBeInstanceOf(LocalPrivateObjectStore);
  expect(createDevelopmentPrivateObjectStore({ ...env, AFHOMES_PRIVATE_STORAGE_PROVIDER: 'local' }, 'http://localhost:3084')).toBeInstanceOf(LocalPrivateObjectStore);
  expect(() => createDevelopmentPrivateObjectStore({ ...env, NODE_ENV: 'production' }, 'http://localhost:3084')).toThrow();
  expect(() => createDevelopmentPrivateObjectStore(env, 'http://example.invalid:3084')).toThrow();
  expect(() => createDevelopmentPrivateObjectStore({ ...env, BETTER_AUTH_SECRET: '' }, 'http://localhost:3084')).toThrow();
  expect(() => createDevelopmentPrivateObjectStore({ ...env, MONGODB_DB: '../escape' }, 'http://localhost:3084')).toThrow();
  expect(() => createDevelopmentPrivateObjectStore({ ...env, AFHOMES_PRIVATE_STORAGE_PROVIDER: 's3' }, 'http://localhost:3084')).toThrow();
});

it('preserves local files across store restarts and serves only unexpired signed downloads', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-storage-test-'));
  let now = Date.now();
  const input = { root, baseURL: 'http://localhost:3084', secret: 'synthetic'.repeat(8), now: () => now };
  const key = 'profile-photos/synthetic/photo.jpg';
  const first = new LocalPrivateObjectStore(input);
  await first.put(key, Buffer.from('synthetic photo'), 'image/jpeg');
  const grant = await first.downloadURL(key, 300);
  const restarted = new LocalPrivateObjectStore(input);
  const server = http.createServer(createMongoDevelopmentHandler(async (req, res) => { await restarted.serve(req, res); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const signedPath = new URL(grant.url).pathname + new URL(grant.url).search;
  try {
    expect(await restarted.exists(key)).toBe(true);
    expect((await fetch(base + '/api/v1/private-files')).status).toBe(403);
    const response = await fetch(base + signedPath);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('synthetic photo');
    expect((await fetch(base + signedPath + 'bad')).status).toBe(403);
    now += 300001;
    expect((await fetch(base + signedPath)).status).toBe(403);
    expect(await restarted.exists(key)).toBe(true);
    await expect(restarted.read('../escape', 100)).rejects.toThrow();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

it('does not select a provider implicitly and refuses insecure or incomplete production configuration', () => {
  expect(createS3PrivateObjectStore({})).toBeUndefined();
  expect(() => createS3PrivateObjectStore({ AFHOMES_PRIVATE_STORAGE_PROVIDER: 'local' })).toThrow();
  expect(() =>
    createS3PrivateObjectStore({
      AFHOMES_PRIVATE_STORAGE_PROVIDER: 's3',
      AFHOMES_S3_ENDPOINT: 'http://storage.example.invalid',
    }),
  ).toThrow();
  expect(() =>
    createS3PrivateObjectStore({
      AFHOMES_PRIVATE_STORAGE_PROVIDER: 's3',
      AFHOMES_S3_ENDPOINT: 'https://storage.example.invalid',
    }),
  ).toThrow();
  expect(
    () =>
      new LocalPrivateObjectStore({
        root: 'unused',
        baseURL: 'https://storage.example.invalid',
        secret: 'synthetic'.repeat(8),
      }),
  ).toThrow();
});

it('exercises official S3 SDK operations over loopback HTTP and emits bounded signed download grants', async () => {
  // Protocol fixture only; live provider credential/bucket-policy acceptance is a separate operator gate.
  const objects = new Map<string, { bytes: Buffer; contentType: string }>(),
    requests: { method: string; authenticated: boolean; cache: string | undefined }[] = [];
  const server = http.createServer(async (req, res) => {
    const key = new URL(req.url ?? '/', 'http://localhost').pathname;
    const authenticated = req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ') === true;
    requests.push({
      method: req.method ?? '',
      authenticated,
      cache: req.headers['cache-control'] as string | undefined,
    });
    if (!authenticated) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(key, {
        bytes: Buffer.concat(chunks),
        contentType: String(req.headers['content-type']),
      });
      res.writeHead(200, { ETag: '"synthetic-etag"' });
      res.end();
      return;
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }
    const object = objects.get(key);
    if (!object) {
      res.writeHead(404, { 'Content-Type': 'application/xml' });
      res.end('<Error><Code>NoSuchKey</Code></Error>');
      return;
    }
    res.writeHead(200, {
      'Content-Type': object.contentType,
      'Content-Length': object.bytes.length,
    });
    res.end(req.method === 'HEAD' ? undefined : object.bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const store = createS3PrivateObjectStore({
      NODE_ENV: 'test',
      AFHOMES_PRIVATE_STORAGE_PROVIDER: 's3',
      AFHOMES_S3_ENDPOINT: base,
      AFHOMES_S3_REGION: 'us-east-1',
      AFHOMES_S3_BUCKET: 'synthetic-private',
      AFHOMES_S3_ACCESS_KEY_ID: 'SYNTHETIC_ACCESS',
      AFHOMES_S3_SECRET_ACCESS_KEY: 'synthetic-secret-for-loopback-protocol-only',
    })!;
    const key = 'profile-photos/synthetic/image.jpg';
    await store.put(key, Buffer.from('synthetic JPEG byte fixture'), 'image/jpeg');
    expect(await store.exists(key)).toBe(true);
    expect(await store.read(key, 100)).toEqual({
      bytes: Buffer.from('synthetic JPEG byte fixture'),
      contentType: 'image/jpeg',
    });
    await expect(store.read(key, 2)).rejects.toThrow('size limit');
    const signed = await store.downloadURL(key, 300),
      url = new URL(signed.url);
    expect(url.origin).toBe(base);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(signed.expiresAt) - Date.now()).toBeLessThanOrEqual(300000);
    await expect(store.downloadURL('../escape', 300)).rejects.toThrow();
    await expect(store.downloadURL(key, 3600)).rejects.toThrow();
    expect((await fetch(base + '/synthetic-private/' + key)).status).toBe(403);
    await store.remove(key);
    expect(await store.exists(key)).toBe(false);
    expect(await store.read(key, 100)).toBeNull();
    expect(requests.filter((row) => row.method === 'PUT')).toEqual([
      { method: 'PUT', authenticated: true, cache: 'private, no-store' },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
