import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  accessSync,
  chmodSync,
  mkdirSync,
  statSync,
  statfsSync,
} from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  statfs,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { consumePrivateDownloadAttempt } from './rate-limit.js';

export type PrivateObjectStoreHealth = {
  provider: 'local' | 's3';
  ok: boolean;
  freeBytes: number | null;
  minFreeBytes: number;
};

export interface PrivateObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  read(key: string, maxBytes: number): Promise<{ bytes: Buffer; contentType: string } | null>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  downloadURL(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: string }>;
  serve?(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  health?(): Promise<PrivateObjectStoreHealth>;
}
export function checkKey(key: string) {
  if (
    !key ||
    key.length > 512 ||
    !/^[A-Za-z0-9._/-]+$/.test(key) ||
    key.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid private object key');
}
function checkTTL(seconds: number) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600)
    throw new Error('Invalid private download lifetime');
}
function checkContentType(value: string) {
  if (!value || value.length > 128 || /[\r\n]/.test(value))
    throw new Error('Invalid private object content type');
}
function integerEnv(value: string | undefined, name: string, fallback: number, min: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min)
    throw new Error(`${name} must be at least ${min}`);
  return parsed;
}
function inside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
function overlap(first: string, second: string) {
  return inside(first, second) || inside(second, first);
}
function scannerFrom(env: NodeJS.ProcessEnv): ((file: string) => Promise<void>) | undefined {
  const command = env.AFHOMES_PRIVATE_STORAGE_SCAN_COMMAND?.trim();
  if (!command) return undefined;
  if (!path.isAbsolute(command)) throw new Error('Private scanner command must be absolute');
  return (file) =>
    new Promise<void>((resolve, reject) => {
      execFile(command, [file], { timeout: 30_000, windowsHide: true }, (error) => {
        if (error) reject(new Error('Private file scan failed'));
        else resolve();
      });
    });
}
function loopback(url: URL) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
function missing(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    (('code' in error && error.code === 'ENOENT') ||
      ('name' in error && error.name === 'NoSuchKey') ||
      ('$metadata' in error &&
        (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 404))
  );
}

/** S3-compatible private bucket. Credentials are explicit server-only configuration. */
export function createS3PrivateObjectStore(env: NodeJS.ProcessEnv): PrivateObjectStore | undefined {
  if (!env.AFHOMES_PRIVATE_STORAGE_PROVIDER) return undefined;
  if (env.AFHOMES_PRIVATE_STORAGE_PROVIDER !== 's3')
    throw new Error('Unsupported private storage provider');
  const endpoint = new URL(env.AFHOMES_S3_ENDPOINT ?? '');
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/' ||
    (endpoint.protocol !== 'https:' &&
      !(
        endpoint.protocol === 'http:' &&
        loopback(endpoint) &&
        ['test', 'development'].includes(env.NODE_ENV ?? '')
      ))
  )
    throw new Error('Private storage requires a secure endpoint');
  const bucket = env.AFHOMES_S3_BUCKET,
    region = env.AFHOMES_S3_REGION,
    accessKeyId = env.AFHOMES_S3_ACCESS_KEY_ID,
    secretAccessKey = env.AFHOMES_S3_SECRET_ACCESS_KEY;
  if (
    !bucket ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    !region ||
    !accessKeyId ||
    !secretAccessKey
  )
    throw new Error('Private storage configuration is incomplete');
  const client = new S3Client({
    endpoint: endpoint.origin,
    region,
    forcePathStyle: loopback(endpoint),
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return {
    async put(key, bytes, contentType) {
      checkKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          CacheControl: 'private, no-store',
        }),
      );
    },
    async read(key, maxBytes) {
      checkKey(key);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw new Error('A private read size limit is required');
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!result.Body) throw new Error('Private object body is unavailable');
        const body = result.Body as Readable;
        if (result.ContentLength !== undefined && result.ContentLength > maxBytes) {
          body.destroy();
          throw new Error('Private object exceeds its size limit');
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of body) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > maxBytes) {
            body.destroy();
            throw new Error('Private object exceeds its size limit');
          }
          chunks.push(bytes);
        }
        return {
          bytes: Buffer.concat(chunks),
          contentType: result.ContentType ?? 'application/octet-stream',
        };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async remove(key) {
      checkKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async exists(key) {
      checkKey(key);
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (missing(error)) return false;
        throw error;
      }
    },
    async downloadURL(key, ttlSeconds) {
      checkKey(key);
      checkTTL(ttlSeconds);
      return {
        url: await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ResponseCacheControl: 'private, no-store',
          }),
          { expiresIn: ttlSeconds },
        ),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      };
    },
  };
}

/** Selected only by the localhost launcher; hosted production uses the explicit local/S3 selector below. */
export function createDevelopmentPrivateObjectStore(env: NodeJS.ProcessEnv, baseURL: string): PrivateObjectStore {
  const base = new URL(baseURL);
  if (env.NODE_ENV !== 'development' || !loopback(base) || base.protocol !== 'http:')
    throw new Error('Development storage requires a loopback development runtime');
  if (
    env.AFHOMES_PRIVATE_STORAGE_PROVIDER &&
    !['local', 'filesystem'].includes(env.AFHOMES_PRIVATE_STORAGE_PROVIDER)
  )
    return createS3PrivateObjectStore(env)!;
  if (env.MONGODB_DB !== 'afhomes_dev' || (env.BETTER_AUTH_SECRET?.length ?? 0) < 32)
    throw new Error('Local storage requires the development database and authentication secret');
  return new LocalPrivateObjectStore({
    root: path.join(homedir(), '.afhomes', 'private-storage', env.MONGODB_DB),
    baseURL,
    secret: createHmac('sha256', env.BETTER_AUTH_SECRET!).update('afhomes-local-private-files-v1').digest('hex'),
  });
}

type DiskStoreInput = {
  root: string;
  baseURL: string;
  secret: string;
  now?: () => number;
  maxObjectBytes?: number;
  maxServeBytes?: number;
  minFreeBytes?: number;
  scanner?: (file: string) => Promise<void>;
};

/**
 * Persistent private files on a local disk.
 *
 * Kept private by construction: the root is outside the web root, every key is
 * generated by the caller, reads reject links, and bytes are only reachable
 * through a short-lived HMAC grant. The production selector is
 * `createHostedPrivateObjectStore`; `LocalPrivateObjectStore` is the loopback
 * development variant.
 */
class DiskPrivateObjectStore implements PrivateObjectStore {
  private root: string;
  private base: URL;
  private secret: string;
  private now: () => number;
  private maxObjectBytes: number;
  private maxServeBytes: number;
  private minFreeBytes: number;
  private scanner?: (file: string) => Promise<void>;
  private rootReal?: string;

  constructor(input: DiskStoreInput) {
    this.base = new URL(input.baseURL);
    if (input.secret.length < 32) throw new Error('Private objects require a signing secret');
    this.root = path.resolve(input.root);
    if (this.root === path.parse(this.root).root)
      throw new Error('Private storage root cannot be a filesystem root');
    this.secret = input.secret;
    this.now = input.now ?? Date.now;
    this.maxObjectBytes = input.maxObjectBytes ?? 16 * 1024 * 1024;
    this.maxServeBytes = input.maxServeBytes ?? 16 * 1024 * 1024;
    this.minFreeBytes = input.minFreeBytes ?? 0;
    this.scanner = input.scanner;
  }

  private file(key: string) {
    checkKey(key);
    const file = path.resolve(this.root, ...key.split('/'));
    if (!inside(this.root, file) || file === this.root)
      throw new Error('Invalid local object path');
    return file;
  }

  private async realRoot() {
    this.rootReal ??= await realpath(this.root).catch(() => this.root);
    return this.rootReal;
  }

  private async assertContained(target: string) {
    const root = await this.realRoot();
    const real = await realpath(target).catch((error) => {
      if (missing(error)) return target;
      throw error;
    });
    if (!inside(root, real)) throw new Error('Invalid local object path');
  }

  private async ensureDirectory(folder: string) {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    try {
      await chmod(folder, 0o700);
    } catch {
      // Some mounted filesystems do not implement chmod.
    }
    await this.assertContained(folder);
  }

  async health(): Promise<PrivateObjectStoreHealth> {
    const base = { provider: 'local' as const, minFreeBytes: this.minFreeBytes };
    try {
      const info = await stat(this.root);
      if (!info.isDirectory()) return { ...base, ok: false, freeBytes: null };
      let freeBytes: number | null = null;
      try {
        if (typeof statfs === 'function') {
          const stats = await statfs(this.root);
          freeBytes = Number(stats.bavail) * Number(stats.bsize);
        }
      } catch {
        // statfs is unavailable on some filesystems; the root check still fails closed.
      }
      return {
        ...base,
        ok: freeBytes === null || freeBytes >= this.minFreeBytes,
        freeBytes,
      };
    } catch {
      return { ...base, ok: false, freeBytes: null };
    }
  }

  private async ensureCapacity(bytes: number) {
    if (bytes < 1) throw new Error('Private objects cannot be empty');
    if (bytes > this.maxObjectBytes)
      throw new Error('Private object exceeds its size limit');
    const health = await this.health();
    if (!health.ok) throw new Error('Private storage is full or unavailable');
    if (health.freeBytes !== null && health.freeBytes < bytes + this.minFreeBytes)
      throw new Error('Private storage is full');
  }

  async put(key: string, bytes: Uint8Array, contentType: string) {
    checkContentType(contentType);
    const file = this.file(key);
    await this.ensureDirectory(path.dirname(file));
    await this.ensureCapacity(bytes.length);
    const temporary = `${file}.${randomUUID()}.tmp`,
      metadata = `${file}.${randomUUID()}.metadata.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
      await writeFile(metadata, JSON.stringify({ contentType }), { mode: 0o600, flag: 'wx' });
      if (this.scanner) await this.scanner(temporary);
      await rename(temporary, file);
      await rename(metadata, file + '.metadata');
    } finally {
      for (const target of [temporary, metadata])
        await unlink(target).catch((error) => {
          if (!missing(error)) throw error;
        });
    }
  }

  async createIfAbsent(key: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
    checkContentType(contentType);
    const file = this.file(key);
    await this.ensureDirectory(path.dirname(file));
    await this.ensureCapacity(bytes.length);
    try {
      await writeFile(file, bytes, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
        return false;
      throw error;
    }
    // An interrupted pair stays blocked for review; never overwrite or delete it on retry.
    await writeFile(file + '.metadata', JSON.stringify({ contentType }), {
      mode: 0o600,
      flag: 'wx',
    });
    return true;
  }

  async read(key: string, maxBytes: number) {
    const file = this.file(key);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
      throw new Error('A private read size limit is required');
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) return null;
      if (info.size > maxBytes) throw new Error('Private object exceeds its size limit');
      await this.assertContained(file);
      const bytes = await readFile(file);
      if (bytes.length > maxBytes) throw new Error('Private object exceeds its size limit');
      const metadata = JSON.parse(await readFile(file + '.metadata', 'utf8')) as {
        contentType: string;
      };
      checkContentType(metadata.contentType);
      return { bytes, contentType: metadata.contentType };
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async remove(key: string) {
    const file = this.file(key);
    for (const target of [file, file + '.metadata'])
      await unlink(target).catch((error) => {
        if (!missing(error)) throw error;
      });
  }

  async exists(key: string) {
    try {
      const info = await lstat(this.file(key));
      if (!info.isFile() || info.isSymbolicLink()) return false;
      await this.assertContained(this.file(key));
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }

  async downloadURL(key: string, ttlSeconds: number) {
    checkKey(key);
    checkTTL(ttlSeconds);
    const expires = this.now() + ttlSeconds * 1000;
    const token = Buffer.from(JSON.stringify({ key, expires })).toString('base64url');
    const url = new URL('/api/v1/private-files', this.base);
    url.searchParams.set('token', token);
    url.searchParams.set(
      'signature',
      createHmac('sha256', this.secret).update(token).digest('hex'),
    );
    return { url: url.toString(), expiresAt: new Date(expires).toISOString() };
  }

  async serve(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.base);
    if (url.pathname !== '/api/v1/private-files') return false;
    const deny = () => {
      res.writeHead(403, { 'Cache-Control': 'no-store' });
      res.end();
      return true;
    };
    const verdict = consumePrivateDownloadAttempt(req);
    if (!verdict.allowed) {
      res.writeHead(429, {
        'Cache-Control': 'no-store',
        'Retry-After': String(verdict.retryAfterSeconds),
      });
      res.end();
      return true;
    }
    try {
      const token = url.searchParams.get('token') ?? '',
        signature = url.searchParams.get('signature') ?? '';
      if (req.method !== 'GET' || token.length > 2048 || !/^[a-f0-9]{64}$/.test(signature))
        return deny();
      const expected = createHmac('sha256', this.secret).update(token).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return deny();
      const payload = JSON.parse(Buffer.from(token, 'base64url').toString()) as {
        key: string;
        expires: number;
      };
      if (
        !Number.isSafeInteger(payload.expires) ||
        payload.expires <= this.now() ||
        payload.expires > this.now() + 600000
      )
        return deny();
      const object = await this.read(payload.key, this.maxServeBytes);
      if (!object) {
        res.writeHead(404, { 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      const inlineImage = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
        object.contentType,
      );
      const filename = path.basename(payload.key).replace(/[^A-Za-z0-9._-]/g, '_');
      res.writeHead(200, {
        'Content-Type': object.contentType,
        'Content-Length': object.bytes.length,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': inlineImage ? 'inline' : `attachment; filename="${filename}"`,
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
        ...(inlineImage ? {} : { 'Content-Security-Policy': "default-src 'none'; sandbox" }),
      });
      res.end(object.bytes);
      return true;
    } catch {
      return deny();
    }
  }
}

/** Existing localhost-only storage contract remains unchanged. */
export class LocalPrivateObjectStore extends DiskPrivateObjectStore {
  constructor(input: { root: string; baseURL: string; secret: string; now?: () => number }) {
    const base = new URL(input.baseURL);
    if (!loopback(base) || base.protocol !== 'http:')
      throw new Error('Local objects require an isolated loopback runtime');
    super(input);
  }
}

/** Explicit hosted selection; files stay outside the static site and releases. No localhost fallback. */
export function createHostedPrivateObjectStore(env: NodeJS.ProcessEnv): PrivateObjectStore {
  if (env.NODE_ENV !== 'production')
    throw new Error('Hosted objects require production configuration');
  const provider = env.AFHOMES_PRIVATE_STORAGE_PROVIDER?.trim();
  if (provider === 's3') return createS3PrivateObjectStore(env)!;
  if (provider !== 'local' && provider !== 'filesystem')
    throw new Error('Select a hosted private storage provider');

  const baseRaw =
    env.AFHOMES_PUBLIC_ORIGIN ?? env.BETTER_AUTH_URL ?? env.AFHOMES_WEB_URL ?? '';
  const base = new URL(baseRaw);
  const root = env.AFHOMES_PRIVATE_STORAGE_ROOT?.trim() ?? '';
  if (
    base.protocol !== 'https:' ||
    loopback(base) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    !path.isAbsolute(root) ||
    (env.BETTER_AUTH_SECRET?.length ?? 0) < 32
  )
    throw new Error('Hosted private storage configuration is invalid');

  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root)
    throw new Error('Private storage root cannot be a filesystem root');
  const cwd = path.resolve(process.cwd());
  if (cwd !== path.parse(cwd).root && inside(cwd, resolved))
    throw new Error('Private storage cannot live inside the application directory');
  const publicRoot = env.AFHOMES_PUBLIC_MEDIA_ROOT?.trim();
  if (publicRoot && overlap(resolved, path.resolve(publicRoot)))
    throw new Error('Private and public media storage must not overlap');
  const assetRoot = env.AFHOMES_ASSET_ROOT?.trim();
  if (assetRoot && path.isAbsolute(assetRoot) && overlap(resolved, path.resolve(assetRoot)))
    throw new Error('Private storage cannot live inside the release assets');

  mkdirSync(resolved, { recursive: true, mode: 0o700 });
  try {
    chmodSync(resolved, 0o700);
  } catch {
    // Some mounted filesystems do not implement chmod; access checks still apply.
  }
  accessSync(resolved, constants.R_OK | constants.W_OK | constants.X_OK);
  if (!statSync(resolved).isDirectory())
    throw new Error('Private storage root must be a directory');

  const minFreeBytes = integerEnv(
    env.AFHOMES_PRIVATE_STORAGE_MIN_FREE_BYTES,
    'AFHOMES_PRIVATE_STORAGE_MIN_FREE_BYTES',
    128 * 1024 * 1024,
    0,
  );
  try {
    if (typeof statfsSync === 'function') {
      const stats = statfsSync(resolved);
      const free = Number(stats.bavail) * Number(stats.bsize);
      if (free < minFreeBytes)
        throw new Error('Private storage has insufficient free space');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('insufficient free space')) throw error;
    // Filesystems without statfs still fail closed through health() on writes.
  }

  return new DiskPrivateObjectStore({
    root: resolved,
    baseURL: base.origin,
    secret: createHmac('sha256', env.BETTER_AUTH_SECRET!)
      .update('afhomes-hosted-private-files-v1')
      .digest('hex'),
    maxObjectBytes: integerEnv(
      env.AFHOMES_PRIVATE_STORAGE_MAX_BYTES,
      'AFHOMES_PRIVATE_STORAGE_MAX_BYTES',
      16 * 1024 * 1024,
      1,
    ),
    maxServeBytes: integerEnv(
      env.AFHOMES_PRIVATE_STORAGE_MAX_BYTES,
      'AFHOMES_PRIVATE_STORAGE_MAX_BYTES',
      16 * 1024 * 1024,
      1,
    ),
    minFreeBytes,
    scanner: scannerFrom(env),
  });
}

/** Optional factory: unset provider keeps private routes closed. */
export function createProductionPrivateObjectStore(
  env: NodeJS.ProcessEnv,
): PrivateObjectStore | undefined {
  const provider = env.AFHOMES_PRIVATE_STORAGE_PROVIDER?.trim();
  if (!provider) return undefined;
  if (provider === 's3') return createS3PrivateObjectStore(env);
  return createHostedPrivateObjectStore(env);
}
