import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
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

export interface PrivateObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  read(key: string, maxBytes: number): Promise<{ bytes: Buffer; contentType: string } | null>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  downloadURL(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: string }>;
  serve?(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}
function checkKey(key: string) {
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

/** Selected only by the localhost launcher; hosted runtimes still require explicit S3 configuration. */
export function createDevelopmentPrivateObjectStore(env: NodeJS.ProcessEnv, baseURL: string): PrivateObjectStore {
  const base = new URL(baseURL);
  if (env.NODE_ENV !== 'development' || !loopback(base) || base.protocol !== 'http:')
    throw new Error('Development storage requires a loopback development runtime');
  if (env.AFHOMES_PRIVATE_STORAGE_PROVIDER && env.AFHOMES_PRIVATE_STORAGE_PROVIDER !== 'local')
    return createS3PrivateObjectStore(env)!;
  if (env.MONGODB_DB !== 'afhomes_dev' || (env.BETTER_AUTH_SECRET?.length ?? 0) < 32)
    throw new Error('Local storage requires the development database and authentication secret');
  return new LocalPrivateObjectStore({
    root: path.join(homedir(), '.afhomes', 'private-storage', env.MONGODB_DB),
    baseURL,
    secret: createHmac('sha256', env.BETTER_AUTH_SECRET!).update('afhomes-local-private-files-v1').digest('hex'),
  });
}

/** Loopback-only private files. The caller owns persistence and disposable fixture cleanup. */
class DiskPrivateObjectStore implements PrivateObjectStore {
  private root: string;
  private base: URL;
  private secret: string;
  private now: () => number;
  constructor(input: { root: string; baseURL: string; secret: string; now?: () => number }) {
    this.base = new URL(input.baseURL);
    if (input.secret.length < 32) throw new Error('Private objects require a signing secret');
    this.root = path.resolve(input.root);
    this.secret = input.secret;
    this.now = input.now ?? Date.now;
  }
  private file(key: string) {
    checkKey(key);
    const file = path.resolve(this.root, ...key.split('/'));
    if (!file.startsWith(this.root + path.sep)) throw new Error('Invalid local object path');
    return file;
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    const file = this.file(key),
      temporary = file + '.' + randomUUID() + '.tmp';
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, file);
      await writeFile(file + '.metadata', JSON.stringify({ contentType }), { mode: 0o600 });
    } finally {
      await unlink(temporary).catch((error) => {
        if (!missing(error)) throw error;
      });
    }
  }
  async read(key: string, maxBytes: number) {
    const file = this.file(key);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
      throw new Error('A private read size limit is required');
    try {
      if ((await stat(file)).size > maxBytes)
        throw new Error('Private object exceeds its size limit');
      const bytes = await readFile(file);
      if (bytes.length > maxBytes) throw new Error('Private object exceeds its size limit');
      const metadata = JSON.parse(await readFile(file + '.metadata', 'utf8')) as {
        contentType: string;
      };
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
      await stat(this.file(key));
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
      const object = await this.read(payload.key, 10 * 1024 * 1024);
      if (!object) {
        res.writeHead(404, { 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      res.writeHead(200, {
        'Content-Type': object.contentType,
        'Content-Length': object.bytes.length,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
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
    if (!loopback(base) || base.protocol !== 'http:') throw new Error('Local objects require an isolated loopback runtime');
    super(input);
  }
}

/** Explicit hosted selection; files stay outside the static site and releases. No localhost fallback. */
export function createHostedPrivateObjectStore(env: NodeJS.ProcessEnv): PrivateObjectStore {
  if (env.NODE_ENV !== 'production') throw new Error('Hosted objects require production configuration');
  if (env.AFHOMES_PRIVATE_STORAGE_PROVIDER === 's3') return createS3PrivateObjectStore(env)!;
  if (env.AFHOMES_PRIVATE_STORAGE_PROVIDER !== 'filesystem') throw new Error('Select a hosted private storage provider');
  const base = new URL(env.AFHOMES_PUBLIC_ORIGIN ?? '');
  const root = env.AFHOMES_PRIVATE_STORAGE_ROOT ?? '';
  if (base.protocol !== 'https:' || loopback(base) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !path.isAbsolute(root) || (env.BETTER_AUTH_SECRET?.length ?? 0) < 32)
    throw new Error('Hosted private storage configuration is invalid');
  return new DiskPrivateObjectStore({ root, baseURL: base.origin,
    secret: createHmac('sha256', env.BETTER_AUTH_SECRET!).update('afhomes-hosted-private-files-v1').digest('hex') });
}
