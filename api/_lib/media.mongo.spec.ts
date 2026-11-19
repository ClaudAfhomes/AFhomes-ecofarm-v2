import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { makeReq, makeRes } from './testing/supabase-fake.js';
import { LocalPublicMediaStore } from './public-media-store.js';
import { createMongoMediaHandlers } from './media.mongo.js';
import type { authorizeAfHomes } from './afhomes-access.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
let replica: Awaited<ReturnType<typeof createTestReplica>>;
const roots: string[] = [];
const env = { AFHOMES_WEB_URL: 'https://portal.afhomes.test' };

const principal = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'media@example.invalid',
  fullName: 'MEDIA ADMIN',
  status: 'active',
  roleId: 'role',
  roleSlug: 'super_admin',
  roleName: 'Super Admin',
  mustChangePassword: false,
  permissions: [],
};

function store(maxBytes = 4096, maxTotalBytes = 8192) {
  const root = mkdtempSync(path.join(tmpdir(), 'afhomes-media-handler-'));
  roots.push(root);
  return new LocalPublicMediaStore({ root, maxBytes, maxTotalBytes });
}

function uploadRequest(
  url: string,
  bytes: Buffer,
  mime = 'image/png',
  method = 'POST',
  origin = env.AFHOMES_WEB_URL!,
) {
  const req = Readable.from([bytes]) as unknown as IncomingMessage;
  Object.assign(req, {
    url,
    method,
    headers: { 'content-type': mime, 'content-length': String(bytes.length), origin },
    socket: { remoteAddress: '127.0.0.1' },
  });
  return req;
}

function uploadResponse() {
  const state = { status: 200, body: '', headers: {} as Record<string, unknown> };
  const res = {
    writeHead(status: number, headers: Record<string, unknown>) {
      state.status = status;
      Object.assign(state.headers, headers);
      return res;
    },
    end(body?: string | Buffer) {
      state.body = body === undefined ? '' : String(body);
    },
  };
  return { res: res as unknown as ServerResponse, state };
}

const authorize = (deny = false) =>
  vi.fn(async () =>
    deny
      ? { error: { status: 403, error: { code: 'FORBIDDEN', message: 'Not allowed' } } }
      : principal,
  ) as unknown as typeof authorizeAfHomes;

async function upload(
  handlers: ReturnType<typeof createMongoMediaHandlers>,
  options: { url: string; bytes?: Buffer; mime?: string; method?: string; origin?: string },
) {
  const response = uploadResponse();
  expect(
    await handlers.upload(
      uploadRequest(options.url, options.bytes ?? PNG, options.mime, options.method, options.origin),
      response.res,
    ),
  ).toBe(true);
  return { ...response.state, json: response.state.body ? JSON.parse(response.state.body) : null };
}

async function call(
  handlers: ReturnType<typeof createMongoMediaHandlers>,
  options: { method: string; familyPath: string; body?: unknown; query?: Record<string, string> },
) {
  const request = makeReq({
    method: options.method,
    familyPath: options.familyPath,
    body: options.body,
    query: options.query,
  });
  const response = makeRes();
  await handlers.handler(request as never, response.res);
  return response.state;
}

beforeAll(async () => {
  replica = await createTestReplica({ timeoutMS: 20_000 });
}, 60_000);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('public media handlers', () => {
  it('uploads, lists, reads, updates, unpublishes, and deletes authorized media', async () => {
    const handlers = createMongoMediaHandlers(replica.db, replica.client, authorize(), store(), env);
    const created = await upload(handlers, {
      url: '/api/v1/media?name=hero.png&alt=Hero&category=website',
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      name: 'hero.png',
      mediaType: 'image',
      status: 'published',
      category: 'website',
      width: 1,
      height: 1,
    });
    expect(created.json.publicUrl).toMatch(/^https:\/\/portal\.afhomes\.test\/media\/.+\.png$/);
    const id = created.json.id;

    const listed = await call(handlers, { method: 'GET', familyPath: '' });
    expect(listed.body).toMatchObject({ meta: { total: 1 }, data: [{ id }] });

    const detail = await call(handlers, { method: 'GET', familyPath: id });
    expect(detail.body).toMatchObject({ id, altText: 'Hero' });

    const updated = await call(handlers, {
      method: 'PATCH',
      familyPath: id,
      body: { altText: 'Updated hero', category: 'promo' },
    });
    expect(updated.body).toMatchObject({ altText: 'Updated hero', category: 'promo' });

    const unpublished = await call(handlers, {
      method: 'PATCH',
      familyPath: id,
      body: { status: 'unpublished' },
    });
    expect(unpublished.body).toMatchObject({ status: 'unpublished' });

    const deleted = await call(handlers, {
      method: 'DELETE',
      familyPath: id,
      query: { confirm: 'true' },
    });
    expect(deleted.body).toEqual({ deleted: true });
    expect(await replica.db.collection('public_media_assets').countDocuments()).toBe(0);
    expect(
      await replica.db.collection('audit_events').countDocuments({ entity_type: 'public_media' }),
    ).toBe(4);
  });

  it('replaces media and removes the previous public file', async () => {
    const handlers = createMongoMediaHandlers(replica.db, replica.client, authorize(), store(), env);
    const first = await upload(handlers, { url: '/api/v1/media?name=first.png' });
    const replacement = await upload(handlers, {
      url: `/api/v1/media/${first.json.id}?name=second.png`,
      method: 'PUT',
    });
    expect(replacement.status).toBe(201);
    expect(replacement.json.id).not.toBe(first.json.id);
    const old = await replica.db
      .collection('public_media_assets')
      .findOne({ _id: first.json.id });
    expect(old?.status).toBe('unpublished');
    expect(old?.replaced_by).toBe(replacement.json.id);
  });

  it('accepts PDF documents and rejects unsupported or oversized bodies', async () => {
    const handlers = createMongoMediaHandlers(replica.db, replica.client, authorize(), store(), env);
    const pdf = await upload(handlers, {
      url: '/api/v1/media?name=notice.pdf',
      bytes: PDF,
      mime: 'application/pdf',
    });
    expect(pdf.status).toBe(201);
    expect(pdf.json.mediaType).toBe('document');

    const svg = await upload(handlers, {
      url: '/api/v1/media?name=x.svg',
      bytes: Buffer.from('<svg/>'),
      mime: 'image/svg+xml',
    });
    expect(svg.status).toBe(400);
    const mismatch = await upload(handlers, {
      url: '/api/v1/media?name=x.jpg',
      bytes: PNG,
      mime: 'image/jpeg',
    });
    expect(mismatch.status).toBe(400);
    const huge = await upload(handlers, {
      url: '/api/v1/media?name=x.png',
      bytes: Buffer.alloc(5000, 1),
    });
    expect(huge.status).toBe(413);
  });

  it('requires cms.media create permission and a configured store', async () => {
    const denied = createMongoMediaHandlers(
      replica.db,
      replica.client,
      authorize(true),
      store(),
      env,
    );
    const refused = await upload(denied, { url: '/api/v1/media?name=x.png' });
    expect(refused.status).toBe(403);

    const crossOrigin = await upload(
      createMongoMediaHandlers(replica.db, replica.client, authorize(), store(), env),
      { url: '/api/v1/media?name=x.png', origin: 'https://evil.example' },
    );
    expect(crossOrigin.status).toBe(403);

    const unconfigured = createMongoMediaHandlers(
      replica.db,
      replica.client,
      authorize(),
      undefined,
      env,
    );
    const unavailable = await upload(unconfigured, { url: '/api/v1/media?name=x.png' });
    expect(unavailable.status).toBe(503);
    expect((await call(unconfigured, { method: 'GET', familyPath: '' })).status).toBe(503);
  });
});
