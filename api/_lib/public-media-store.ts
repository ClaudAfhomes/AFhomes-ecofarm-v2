import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

export type PublicMediaKind = 'image' | 'document';

export type PublicMediaValidation = {
  mimeType: string;
  mediaType: PublicMediaKind;
  extension: string;
  width: number | null;
  height: number | null;
};

export type PublicMediaWrite = PublicMediaValidation & {
  key: string;
  sizeBytes: number;
};

export type PublicMediaErrorCode =
  | 'UNAVAILABLE'
  | 'UNSUPPORTED_TYPE'
  | 'INVALID_CONTENT'
  | 'TOO_LARGE'
  | 'FULL'
  | 'NOT_FOUND';

export class PublicMediaError extends Error {
  constructor(
    readonly code: PublicMediaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PublicMediaError';
  }
}

const MIME_TYPES: Record<
  string,
  { extension: string; mediaType: PublicMediaKind; contentType: string }
> = {
  'image/jpeg': { extension: 'jpg', mediaType: 'image', contentType: 'image/jpeg' },
  'image/png': { extension: 'png', mediaType: 'image', contentType: 'image/png' },
  'image/webp': { extension: 'webp', mediaType: 'image', contentType: 'image/webp' },
  'image/gif': { extension: 'gif', mediaType: 'image', contentType: 'image/gif' },
  'application/pdf': {
    extension: 'pdf',
    mediaType: 'document',
    contentType: 'application/pdf',
  },
};

const EXTENSION_MIME = Object.fromEntries(
  Object.entries(MIME_TYPES).map(([mime, value]) => [value.extension, mime]),
);

/** Generated keys only. No user-controlled path segment can match. */
export const PUBLIC_MEDIA_KEY_RE = /^[a-f0-9-]{36}\.(?:jpg|png|webp|gif|pdf)$/;

function normalizeMime(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

function pdfSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || Buffer.from(bytes.slice(0, 5)).toString('latin1') !== '%PDF-')
    return false;
  return Buffer.from(bytes.slice(Math.max(0, bytes.length - 2048))).includes('%%EOF');
}

function imageSignature(mime: string, bytes: Uint8Array): boolean {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png')
    return (
      bytes.length >= 8 &&
      bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])
    );
  if (mime === 'image/gif')
    return /^GIF8[79]a$/.test(Buffer.from(bytes.slice(0, 6)).toString('ascii'));
  if (mime === 'image/webp')
    return (
      Buffer.from(bytes.slice(0, 4)).toString('ascii') === 'RIFF' &&
      Buffer.from(bytes.slice(8, 12)).toString('ascii') === 'WEBP'
    );
  return false;
}

function imageDimensions(
  mime: string,
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (mime === 'image/png') {
    if (bytes.length < 24) return null;
    const view = Buffer.from(bytes);
    const width = view.readUInt32BE(16);
    const height = view.readUInt32BE(20);
    return width && height ? { width, height } : null;
  }
  if (mime === 'image/gif') {
    if (bytes.length < 10) return null;
    const width = bytes[6]! | (bytes[7]! << 8);
    const height = bytes[8]! | (bytes[9]! << 8);
    return width && height ? { width, height } : null;
  }
  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      let marker = bytes[offset + 1]!;
      offset += 2;
      while (marker === 0xff) marker = bytes[offset++]!;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > bytes.length) return null;
      const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
      if (length < 2 || offset + length > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
        const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
        return width && height ? { width, height } : null;
      }
      if (marker === 0xda) return null;
      offset += length;
    }
  }
  return null;
}

/** Validate the declared type against the bytes, not the extension alone. */
export function validatePublicMedia(mimeType: string, bytes: Uint8Array): PublicMediaValidation {
  const mime = normalizeMime(mimeType);
  const descriptor = MIME_TYPES[mime];
  if (!descriptor) throw new PublicMediaError('UNSUPPORTED_TYPE', 'Unsupported media type');
  if (!bytes.length) throw new PublicMediaError('INVALID_CONTENT', 'The file is empty');
  const valid =
    descriptor.mediaType === 'document'
      ? pdfSignature(bytes)
      : imageSignature(mime, bytes);
  if (!valid) throw new PublicMediaError('INVALID_CONTENT', 'File contents do not match the type');
  const dimensions =
    descriptor.mediaType === 'image' ? imageDimensions(mime, bytes) : null;
  return {
    mimeType: descriptor.contentType,
    mediaType: descriptor.mediaType,
    extension: descriptor.extension,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}

export type PublicMediaStore = {
  readonly root: string;
  readonly maxBytes: number;
  put(bytes: Uint8Array, mimeType: string): Promise<PublicMediaWrite>;
  read(key: string): Promise<{ bytes: Buffer; mimeType: string } | null>;
  remove(key: string): Promise<void>;
  totalBytes(): Promise<number>;
  publicPath(key: string): string;
  serve(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
};

function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error('Invalid public media size limit');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1024) throw new Error('Invalid public media size limit');
  return parsed;
}

export class LocalPublicMediaStore implements PublicMediaStore {
  readonly root: string;
  readonly maxBytes: number;
  readonly maxTotalBytes: number;

  constructor(input: { root: string; maxBytes: number; maxTotalBytes: number }) {
    if (!path.isAbsolute(input.root)) throw new Error('Public media root must be absolute');
    this.root = path.resolve(input.root);
    if (this.root === path.parse(this.root).root)
      throw new Error('Public media root cannot be a filesystem root');
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1)
      throw new Error('Invalid public media size limit');
    if (!Number.isSafeInteger(input.maxTotalBytes) || input.maxTotalBytes < input.maxBytes)
      throw new Error('Invalid public media total limit');
    this.maxBytes = input.maxBytes;
    this.maxTotalBytes = input.maxTotalBytes;
  }

  private async ready(): Promise<void> {
    try {
      const info = await stat(this.root);
      if (!info.isDirectory()) throw new Error('not a directory');
      await access(this.root, constants.R_OK | constants.W_OK | constants.X_OK);
    } catch {
      throw new PublicMediaError('UNAVAILABLE', 'Public media storage is unavailable');
    }
  }

  private file(key: string): string {
    if (!PUBLIC_MEDIA_KEY_RE.test(key))
      throw new PublicMediaError('NOT_FOUND', 'Media not found');
    return path.join(this.root, key);
  }

  async put(bytes: Uint8Array, mimeType: string): Promise<PublicMediaWrite> {
    await this.ready();
    if (bytes.length > this.maxBytes)
      throw new PublicMediaError('TOO_LARGE', 'Media exceeds the size limit');
    const validation = validatePublicMedia(mimeType, bytes);
    const used = await this.totalBytes();
    if (used + bytes.length > this.maxTotalBytes)
      throw new PublicMediaError('FULL', 'Public media storage is full');
    const key = `${randomUUID()}.${validation.extension}`;
    const file = this.file(key);
    const temporary = path.join(this.root, `.upload-${randomUUID()}`);
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o644 });
      await rename(temporary, file);
    } catch {
      await unlink(temporary).catch(() => {});
      throw new PublicMediaError('UNAVAILABLE', 'Public media storage is unavailable');
    }
    return { key, sizeBytes: bytes.length, ...validation };
  }

  async read(key: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
    const file = this.file(key);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > this.maxBytes)
        throw new PublicMediaError('NOT_FOUND', 'Media not found');
      const extension = path.extname(file).slice(1);
      const mimeType = EXTENSION_MIME[extension];
      if (!mimeType) throw new PublicMediaError('NOT_FOUND', 'Media not found');
      return { bytes: await readFile(file), mimeType };
    } catch (error) {
      if (error instanceof PublicMediaError) throw error;
      if (isMissing(error)) return null;
      throw new PublicMediaError('UNAVAILABLE', 'Public media storage is unavailable');
    }
  }

  async remove(key: string): Promise<void> {
    const file = this.file(key);
    await unlink(file).catch((error) => {
      if (!isMissing(error)) throw new PublicMediaError('UNAVAILABLE', 'Public media storage is unavailable');
    });
  }

  async totalBytes(): Promise<number> {
    await this.ready();
    let total = 0;
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const info = await stat(path.join(this.root, entry.name)).catch(() => null);
      if (info?.isFile()) total += info.size;
    }
    return total;
  }

  publicPath(key: string): string {
    if (!PUBLIC_MEDIA_KEY_RE.test(key)) throw new PublicMediaError('NOT_FOUND', 'Media not found');
    return `/media/${key}`;
  }

  async serve(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = /^\/media\/([^/]+)$/.exec(url.pathname);
    if (!match) return false;
    const key = match[1]!;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
    let object: { bytes: Buffer; mimeType: string } | null;
    try {
      object = await this.read(key);
    } catch (error) {
      if (error instanceof PublicMediaError && error.code === 'NOT_FOUND') {
        res.writeHead(404, { 'Cache-Control': 'no-store' });
      } else {
        res.writeHead(503, { 'Cache-Control': 'no-store' });
      }
      res.end();
      return true;
    }
    if (!object) {
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
    const document = object.mimeType === 'application/pdf';
    res.writeHead(200, {
      'Content-Type': object.mimeType,
      'Content-Length': object.bytes.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': document ? `attachment; filename="${key}"` : 'inline',
      ...(document ? { 'Content-Security-Policy': "default-src 'none'; sandbox" } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : object.bytes);
    return true;
  }
}

/** Explicitly configured only; an unset root disables public media. */
export function createLocalPublicMediaStore(
  env: NodeJS.ProcessEnv = process.env,
): PublicMediaStore | undefined {
  const root = env.AFHOMES_PUBLIC_MEDIA_ROOT?.trim();
  if (!root) return undefined;
  if (!path.isAbsolute(root))
    throw new Error('AFHOMES_PUBLIC_MEDIA_ROOT must be an absolute path');
  return new LocalPublicMediaStore({
    root,
    maxBytes: parseLimit(env.AFHOMES_PUBLIC_MEDIA_MAX_BYTES, 10 * 1024 * 1024),
    maxTotalBytes: parseLimit(
      env.AFHOMES_PUBLIC_MEDIA_MAX_TOTAL_BYTES,
      2 * 1024 * 1024 * 1024,
    ),
  });
}
