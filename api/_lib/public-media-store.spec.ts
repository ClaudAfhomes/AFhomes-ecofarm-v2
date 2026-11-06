import http from 'node:http';
import { chmodSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalPublicMediaStore,
  PublicMediaError,
  createLocalPublicMediaStore,
} from './public-media-store.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const roots: string[] = [];

function root(maxBytes = 4096, maxTotalBytes = 8192) {
  const dir = mkdtempSync(path.join(tmpdir(), 'afhomes-public-media-'));
  roots.push(dir);
  return { dir, store: new LocalPublicMediaStore({ root: dir, maxBytes, maxTotalBytes }) };
}

async function serve(store: LocalPublicMediaStore, url: string) {
  const server = http.createServer((req, res) => {
    void store.serve(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    return await fetch(`http://127.0.0.1:${port}${url}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

afterEach(() => {
  for (const dir of roots.splice(0)) {
    try {
      chmodSync(dir, 0o755);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('local public media store', () => {
  it('writes validated images and PDFs with generated names', async () => {
    const { dir, store } = root();
    const image = await store.put(PNG, 'image/png');
    expect(image.key).toMatch(/^[a-f0-9-]{36}\.png$/);
    expect(image).toMatchObject({ mediaType: 'image', width: 1, height: 1, sizeBytes: PNG.length });
    expect(store.publicPath(image.key)).toBe(`/media/${image.key}`);
    const saved = await store.read(image.key);
    expect(saved?.mimeType).toBe('image/png');
    expect(saved?.bytes.equals(PNG)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(path.join(dir, image.key)).mode & 0o777).toBe(0o644);

    const pdf = await store.put(PDF, 'application/pdf');
    expect(pdf.key).toMatch(/\.pdf$/);
    expect(pdf).toMatchObject({ mediaType: 'document', width: null, height: null });
  });

  it('rejects unsupported types, signature mismatches, and oversize files', async () => {
    const { store } = root(80, 160);
    await expect(store.put(Buffer.from('<svg/>'), 'image/svg+xml')).rejects.toMatchObject({
      code: 'UNSUPPORTED_TYPE',
    });
    await expect(store.put(PNG, 'image/jpeg')).rejects.toMatchObject({
      code: 'INVALID_CONTENT',
    });
    await expect(store.put(Buffer.alloc(100, 1), 'image/png')).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
    await expect(store.put(Buffer.from('not a pdf'), 'application/pdf')).rejects.toMatchObject({
      code: 'INVALID_CONTENT',
    });
  });

  it('enforces the total storage cap before writing', async () => {
    const { store } = root(100, 100);
    await store.put(PNG, 'image/png');
    await expect(store.put(PNG, 'image/png')).rejects.toMatchObject({ code: 'FULL' });
  });

  it('rejects traversal keys and symlinks', async () => {
    const { dir, store } = root();
    await expect(store.read('../secret.png')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(() => store.publicPath('../secret.png')).toThrow(PublicMediaError);
    expect((await serve(store, '/media/%2e%2e%2fsecret.png')).status).toBe(404);
    expect((await serve(store, '/media/../../secret.png')).status).toBe(404);
    if (process.platform !== 'win32') {
      const outside = path.join(tmpdir(), `afhomes-outside-${Date.now()}.png`);
      writeFileSync(outside, PNG);
      const key = '00000000-0000-4000-8000-000000000000.png';
      symlinkSync(outside, path.join(dir, key));
      await expect(store.read(key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      rmSync(outside, { force: true });
    }
  });

  it('fails closed when the directory is missing or not writable', async () => {
    const missing = new LocalPublicMediaStore({
      root: path.join(tmpdir(), 'afhomes-media-does-not-exist'),
      maxBytes: 1024,
      maxTotalBytes: 2048,
    });
    await expect(missing.put(PNG, 'image/png')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    if (process.platform !== 'win32') {
      const { dir, store } = root();
      chmodSync(dir, 0o555);
      await expect(store.put(PNG, 'image/png')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
      chmodSync(dir, 0o755);
    }
  });

  it('persists across store instances and serves immutable public URLs', async () => {
    const { dir, store } = root();
    const saved = await store.put(PNG, 'image/png');
    const restarted = new LocalPublicMediaStore({ root: dir, maxBytes: 4096, maxTotalBytes: 8192 });
    expect((await restarted.read(saved.key))?.bytes.equals(PNG)).toBe(true);

    const image = await serve(store, `/media/${saved.key}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('cache-control')).toContain('immutable');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');

    const pdf = await store.put(PDF, 'application/pdf');
    const document = await serve(store, `/media/${pdf.key}`);
    expect(document.headers.get('content-disposition')).toContain('attachment');
    expect(document.headers.get('content-security-policy')).toContain('sandbox');
    expect((await serve(store, `/media/${saved.key.replace('.png', '.pdf')}`)).status).toBe(404);
  });

  it('requires an explicit absolute root', () => {
    expect(createLocalPublicMediaStore({})).toBeUndefined();
    expect(() =>
      createLocalPublicMediaStore({ AFHOMES_PUBLIC_MEDIA_ROOT: 'relative/media' }),
    ).toThrow('absolute');
  });
});
