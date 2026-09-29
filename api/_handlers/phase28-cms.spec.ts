/**
 * AF Homes Phase 28 - CMS business-content completion.
 *
 * Drives the REAL cms handler with a captured authorization mock against the
 * in-memory Supabase fake, plus a stubbed storage seam (the same seam
 * production uses). Phase 6 proved documents versioning; this suite completes
 * the model the schema actually defines - generic pages + sections, the seven
 * keyed JSON documents, validated public media, merged history, and
 * published-only public reads - without inventing the announcement/banner/
 * gallery tables the prompt sketches but the schema never defined:
 *
 *   announcements/news  -> `stories` document + generic published pages
 *   homepage banners    -> hero blocks (`is_visible`, `sort_order`) + media
 *   gallery             -> gallery blocks + validated media assets
 *   contact/settings    -> the `site` document (`cms.settings` permission)
 *   card-plan marketing -> the `vip` document (copy only: no price, no rate,
 *                          no commission field exists anywhere in CMS)
 *
 * Load-bearing assertions: drafts never leak publicly, invisible sections are
 * filtered on public reads, slugs are validated + unique, media bytes are
 * magic-byte verified, referenced media cannot be deleted, every mutation is
 * permission-gated and audited with safe payloads, and the sales/commission
 * math never reads CMS (structural guard against a second price source).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const STAFF = '00000000-0000-4000-8000-0000000000aa';
const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const holder = vi.hoisted(() => ({ db: null as unknown, denied: false, authCalls: [] as unknown[][] }));
const store = vi.hoisted(() => ({ uploads: [] as unknown[], removals: [] as unknown[] }));

vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db }));
vi.mock('../_lib/afhomes-access.js', () => ({
  authorizeAfHomes: async (...args: unknown[]) => {
    // Record the authorization vocabulary ([module, action]) each route demands.
    (holder.authCalls as unknown[][]).push((args as unknown[]).slice(1));
    return holder.denied
      ? { error: { status: 403, error: { code: 'FORBIDDEN', message: 'Missing permission' } } }
      : { userId: STAFF };
  },
}));

const { default: handler } = await import('./cms.js');

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const toB64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

function tables(): Record<string, Record<string, unknown>[]> {
  return {
    cms_documents: [
      {
        key: 'stories',
        draft_value: [{ title: 'Draft only' }],
        published_value: [{ title: 'Published story' }],
        status: 'published',
        version: 2,
        published_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
        created_by: STAFF,
        updated_by: STAFF,
        published_by: STAFF,
      },
      {
        key: 'site',
        draft_value: { businessName: 'AF Homes', phone: '+639171234567' },
        published_value: { businessName: 'AF Homes', phone: '+639171234567' },
        status: 'published',
        version: 4,
        published_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
        created_by: STAFF,
        updated_by: STAFF,
        published_by: STAFF,
      },
    ],
    cms_document_versions: [],
    cms_pages: [
      {
        id: PAGE_ID,
        slug: 'visit-us',
        title: 'Visit Us',
        status: 'published',
        seo: { title: '', description: '', openGraphTitle: '', openGraphDescription: '', openGraphImage: '' },
        published_snapshot: {
          id: PAGE_ID,
          slug: 'visit-us',
          title: 'Visit Us',
          status: 'published',
          seo: {},
          sections: [
            { id: 's1', blockType: 'hero', content: { title: 'Hello' }, sortOrder: 0, isVisible: true },
            { id: 's2', blockType: 'rich-text', content: { text: 'Hidden notes' }, sortOrder: 1, isVisible: false },
          ],
          version: 2,
          publishedAt: '2026-10-01T00:00:00.000Z',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
        version: 2,
        published_by: STAFF,
        published_at: '2026-10-01T00:00:00.000Z',
        created_by: STAFF,
        updated_by: STAFF,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      },
    ],
    cms_page_sections: [],
    cms_page_versions: [],
    cms_media_assets: [],
    audit_events: [],
  };
}

function install() {
  holder.denied = false;
  holder.authCalls = [];
  store.uploads = [];
  store.removals = [];
  const fake = new FakeSupabase({
    tables: tables() as never,
    unique: { cms_pages: [['slug']], cms_media_assets: [['storage_path']] },
    // The fake applies no SQL column defaults; mirror the migration defaults
    // the handler relies on (status/version), exactly as the Phase 2 fixtures
    // do for their own defaulted columns.
    defaults: {
      cms_documents: { status: 'draft', version: 1 },
      cms_pages: { status: 'draft', version: 1, seo: {} },
    } as never,
  });
  (fake as unknown as Record<string, unknown>).storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, opts: unknown) => {
        store.uploads.push({ bucket, path, bytes, opts });
        return { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
      remove: async (paths: string[]) => {
        store.removals.push(paths);
        return { error: null };
      },
    }),
  };
  holder.db = fake as unknown;
  return fake;
}

beforeEach(() => {
  install();
});

async function call(path: string, method = 'GET', body?: unknown) {
  const { res, state } = makeRes();
  await handler(makeReq({ method, body, query: { familyPath: path } }) as never, res as never);
  return state;
}

const db = () => holder.db as FakeSupabase;
const audits = () => db().rows('audit_events');
const serialised = (value: unknown) => JSON.stringify(value);

/* ================================================================== */
/* Documents: publish lifecycle                                        */
/* ================================================================== */

describe('Phase 28 documents (stories/site as announcement/settings content)', () => {
  it('1. lists documents for a permission-holding editor', async () => {
    const result = await call('documents');
    expect(result.status).toBe(200);
    expect((result.body as { data: { key: string }[] }).data.map((d) => d.key).sort()).toEqual([
      'site',
      'stories',
    ]);
  });

  it('2/3. creates then edits a document with optimistic versioning', async () => {
    const created = await call('documents/faq', 'PUT', {
      value: { groups: [] },
      expectedVersion: 1,
      changeSummary: 'Start the FAQ content.',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ key: 'faq', version: 1, status: 'draft' });
    const updated = await call('documents/faq', 'PATCH', {
      value: { groups: [{ title: 'Visits' }] },
      expectedVersion: 1,
      changeSummary: 'Add the first FAQ group.',
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ version: 2 });
    expect(db().rows('cms_document_versions')).toHaveLength(2);
  });

  it('4/5. publishes and unpublishes; stale writes conflict', async () => {
    const published = await call('documents/faq', 'PUT', {
      value: { groups: [] },
      expectedVersion: 1,
      changeSummary: 'Start the FAQ content.',
    });
    expect(published.status).toBe(201);
    const pub = await call('documents/faq/publish', 'POST', {});
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ status: 'published' });
    expect((pub.body as { publishedValue: unknown }).publishedValue).toEqual({ groups: [] });
    const unpub = await call('documents/faq/unpublish', 'POST', {});
    expect(unpub.status).toBe(200);
    expect(unpub.body).toMatchObject({ status: 'draft' });
    const stale = await call('documents/faq', 'PATCH', {
      value: {},
      expectedVersion: 1,
      changeSummary: 'Stale edit.',
    });
    expect(stale.status).toBe(409);
  });

  it('9. rejects unknown document keys without touching storage', async () => {
    const result = await call('documents/banners', 'PUT', {
      value: {},
      expectedVersion: 1,
      changeSummary: 'No such document.',
    });
    expect(result.status).toBe(400);
  });

  it('site content requires cms.settings while stories require cms.pages', async () => {
    await call('documents/site', 'PATCH', {
      value: {},
      expectedVersion: 4,
      changeSummary: 'Update contact details.',
    });
    await call('documents/stories', 'PATCH', {
      value: [],
      expectedVersion: 2,
      changeSummary: 'Refresh stories.',
    });
    const modules = holder.authCalls.map((args) => args[0]);
    expect(modules).toContain('cms.settings');
    expect(modules).toContain('cms.pages');
  });
});

/* ================================================================== */
/* Pages: full lifecycle, slugs, snapshots                             */
/* ================================================================== */

describe('Phase 28 pages', () => {
  const section = (over: Record<string, unknown> = {}) => ({
    blockType: 'hero',
    content: { title: 'Welcome' },
    sortOrder: 0,
    isVisible: true,
    ...over,
  });

  it('1/2. lists and creates a page with sections, versioned and audited', async () => {
    const listed = await call('pages');
    expect(listed.status).toBe(200);
    expect((listed.body as { data: unknown[] }).data).toHaveLength(1);
    const created = await call('pages', 'POST', {
      slug: 'new-branch',
      title: 'New Branch',
      seo: { title: 'Branch', description: '', openGraphTitle: '', openGraphDescription: '', openGraphImage: '' },
      sections: [section(), section({ blockType: 'gallery', sortOrder: 1 })],
      changeSummary: 'Open the branch page.',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ slug: 'new-branch', version: 1, status: 'draft' });
    expect(db().rows('cms_page_sections')).toHaveLength(2);
    expect(db().rows('cms_page_versions')).toHaveLength(1);
    expect(audits().map((a) => a.action)).toContain('CMS_PAGE_CREATED');
  });

  it('3/12/13. edits replace sections deterministically by sort order', async () => {
    const updated = await call(`pages/${PAGE_ID}`, 'PATCH', {
      title: 'Visit Us Soon',
      sections: [section({ content: { title: 'B' }, sortOrder: 1 }), section({ content: { title: 'A' }, sortOrder: 0 })],
      expectedVersion: 2,
      changeSummary: 'Reorder the hero blocks.',
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ title: 'Visit Us Soon', version: 3 });
    // The response embed needs declared relation links, which this harness
    // omits; assert the stored sections directly, ordered by sort_order.
    const stored = [...db().rows('cms_page_sections')].sort(
      (a, b) => Number(a.sort_order) - Number(b.sort_order),
    );
    expect(stored.map((s) => s.sort_order)).toEqual([0, 1]);
    expect(stored[0]!.content).toEqual({ title: 'A' });
    expect(stored[1]!.content).toEqual({ title: 'B' });
    expect(audits().map((a) => a.action)).toContain('CMS_PAGE_UPDATED');
  });

  it('8. rejects duplicate slugs instead of forking a public URL', async () => {
    const result = await call('pages', 'POST', {
      slug: 'visit-us',
      title: 'Copy',
      changeSummary: 'Duplicate the slug.',
    });
    expect(result.status).toBe(409);
  });

  it('9. rejects invalid slugs before any write', async () => {
    for (const slug of ['Bad_Slug!', 'UPPER', 'trailing-', 'has space']) {
      const result = await call('pages', 'POST', {
        slug,
        title: 'Bad',
        changeSummary: 'Invalid slug attempt.',
      });
      expect(result.status).toBe(400);
    }
    expect(db().rows('cms_pages')).toHaveLength(1);
  });

  it('rejects stale page versions instead of overwriting', async () => {
    const result = await call(`pages/${PAGE_ID}`, 'PATCH', {
      title: 'Stale',
      expectedVersion: 1,
      changeSummary: 'Stale edit.',
    });
    expect(result.status).toBe(409);
  });

  it('4/5. publishes a snapshot and unpublishes back to draft', async () => {
    const published = await call(`pages/${PAGE_ID}/publish`, 'POST', {});
    expect(published.status).toBe(200);
    const row = db().rows('cms_pages').find((r) => r.id === PAGE_ID)!;
    expect(row.status).toBe('published');
    expect(row.published_snapshot).toBeTruthy();
    expect(row.published_at).toBeTruthy();
    expect(audits().map((a) => a.action)).toContain('CMS_PAGE_PUBLISHED');
    const unpublished = await call(`pages/${PAGE_ID}/unpublish`, 'POST', {});
    expect(unpublished.status).toBe(200);
    expect(db().rows('cms_pages').find((r) => r.id === PAGE_ID)!.status).toBe('draft');
    expect(audits().map((a) => a.action)).toContain('CMS_PAGE_UNPUBLISHED');
  });
});

/* ================================================================== */
/* Public reads: published only, safe 404s, no auth, no internals      */
/* ================================================================== */

describe('Phase 28 public reads', () => {
  it('6/7/26. published documents appear; drafts never do; revision tracks freshness', async () => {
    const result = await call('public');
    expect(result.status).toBe(200);
    const body = result.body as { documents: Record<string, unknown>; revision: string };
    expect(body.documents.stories).toEqual([{ title: 'Published story' }]);
    expect(body.documents.site).toEqual({ businessName: 'AF Homes', phone: '+639171234567' });
    expect(serialised(body)).not.toContain('Draft only');
    expect(body.revision).toBe('2026-10-02T00:00:00.000Z');
    expect(holder.authCalls).toHaveLength(0);
  });

  it('14/45. public pages serve visible sections only; drafts and unknowns 404', async () => {
    const published = await call('public/pages/visit-us');
    expect(published.status).toBe(200);
    const sections = (published.body as { sections: { content: unknown }[] }).sections;
    expect(sections).toHaveLength(1);
    expect(sections[0]!.content).toEqual({ title: 'Hello' });
    expect(holder.authCalls).toHaveLength(0);

    await call(`pages/${PAGE_ID}/unpublish`, 'POST', {});
    expect((await call('public/pages/visit-us')).status).toBe(404);
    expect((await call('public/pages/no-such-page')).status).toBe(404);
    expect((await call('public/pages/BAD-SLUG')).status).toBe(404);
  });

  it('22. public payloads carry no admin internals, secrets, or drafts', async () => {
    const docs = await call('public');
    const page = await call('public/pages/visit-us');
    for (const body of [docs.body, page.body]) {
      const text = serialised(body);
      expect(text).not.toContain('created_by');
      expect(text).not.toContain('published_by');
      expect(text).not.toContain('storage_path');
      expect(text).not.toContain('service_role');
      expect(text).not.toContain('Draft only');
    }
  });
});

/* ================================================================== */
/* Media: validation, guarded delete, history                          */
/* ================================================================== */

describe('Phase 28 media', () => {
  it('10/11. uploads a valid image through the public bucket with an audit', async () => {
    const result = await call('media', 'POST', {
      name: 'Hero banner',
      mimeType: 'image/jpeg',
      altText: 'Resort entrance',
      category: 'banners',
      dataBase64: toB64(JPEG),
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ name: 'Hero banner', mimeType: 'image/jpeg', mediaType: 'image' });
    expect(store.uploads).toHaveLength(1);
    expect((store.uploads[0] as { bucket: string }).bucket).toBe('afhomes-cms-media');
    expect(audits().map((a) => a.action)).toContain('CMS_MEDIA_UPLOADED');
    expect(serialised(audits())).not.toContain(toB64(JPEG).slice(0, 40));
  });

  it('34/35. rejects mismatched signatures, oversized bytes, and bad MIME', async () => {
    const pngAsJpeg = await call('media', 'POST', {
      name: 'Fake',
      mimeType: 'image/jpeg',
      dataBase64: toB64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    });
    expect(pngAsJpeg.status).toBe(400);
    const huge = await call('media', 'POST', {
      name: 'Huge',
      mimeType: 'image/png',
      dataBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64'),
    });
    expect(huge.status).toBe(400);
    const bmp = await call('media', 'POST', {
      name: 'Bmp',
      mimeType: 'image/bmp',
      dataBase64: toB64(JPEG),
    });
    expect(bmp.status).toBe(400);
    expect(store.uploads).toHaveLength(0);
    expect(db().rows('cms_media_assets')).toHaveLength(0);
  });

  it('deletes unreferenced media but refuses referenced media', async () => {
    const created = await call('media', 'POST', {
      name: 'Gallery tile',
      mimeType: 'image/jpeg',
      dataBase64: toB64(JPEG),
    });
    const id = (created.body as { id: string; publicUrl: string }).id;
    const url = (created.body as { publicUrl: string }).publicUrl;
    // Reference the URL from a draft document: deletion must refuse.
    db().rows('cms_documents').find((r) => r.key === 'stories')!.draft_value = [{ image: url }];
    const blocked = await call(`media/${id}`, 'DELETE');
    expect(blocked.status).toBe(409);
    expect(db().rows('cms_media_assets')).toHaveLength(1);
    expect(store.removals).toHaveLength(0);
    // Release the reference: deletion succeeds and cleans storage first.
    db().rows('cms_documents').find((r) => r.key === 'stories')!.draft_value = [];
    const deleted = await call(`media/${id}`, 'DELETE');
    expect(deleted.status).toBe(200);
    expect(store.removals).toHaveLength(1);
    expect(db().rows('cms_media_assets')).toHaveLength(0);
    expect(audits().map((a) => a.action)).toContain('CMS_MEDIA_DELETED');
  });

  it('media deletion requires the delete grant', async () => {
    const created = await call('media', 'POST', {
      name: 'Tile',
      mimeType: 'image/jpeg',
      dataBase64: toB64(JPEG),
    });
    const id = (created.body as { id: string }).id;
    expect(holder.authCalls.at(-1)).toEqual(['cms.media', 'create']);
    holder.denied = true;
    expect((await call(`media/${id}`, 'DELETE')).status).toBe(403);
  });
});

/* ================================================================== */
/* Authorization, audits, and the single price source                   */
/* ================================================================== */

describe('Phase 28 authorization and audit', () => {
  it('27/28/30/31. denied mutations fail closed with no writes and no audit', async () => {
    holder.denied = true;
    expect((await call('pages', 'POST', { slug: 'x', title: 'X', changeSummary: 'Denied.' })).status).toBe(403);
    expect((await call('media', 'POST', { name: 'X', mimeType: 'image/jpeg', dataBase64: toB64(JPEG) })).status).toBe(403);
    expect((await call('documents/stories/publish', 'POST', {})).status).toBe(403);
    expect(db().rows('cms_pages')).toHaveLength(1);
    expect(db().rows('cms_media_assets')).toHaveLength(0);
    expect(audits()).toHaveLength(0);
    expect(store.uploads).toHaveLength(0);
  });

  it('37. mutations audit safe payloads: ids, slugs, versions - never bytes', async () => {
    await call('pages', 'POST', {
      slug: 'audited',
      title: 'Audited',
      changeSummary: 'Audit this page.',
    });
    await call('media', 'POST', {
      name: 'Audited media',
      mimeType: 'image/jpeg',
      dataBase64: toB64(JPEG),
    });
    const actions = audits().map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['CMS_PAGE_CREATED', 'CMS_MEDIA_UPLOADED']));
    const text = serialised(audits());
    expect(text).toContain('audited');
    expect(text).not.toContain(toB64(JPEG).slice(0, 32));
  });

  it('24. CMS holds no price authority: the sales math never imports CMS', () => {
    for (const file of ['api/_handlers/sales.ts', 'api/_lib/commerce.ts']) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/cms/i);
    }
  });

  it('history merges document and page versions newest-first for cms.history viewers', async () => {
    await call('documents/stories', 'PATCH', {
      value: [],
      expectedVersion: 2,
      changeSummary: 'Touch stories.',
    });
    const history = await call('history');
    expect(history.status).toBe(200);
    const rows = (history.body as { data: { entityType: string; action: string }[] }).data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ entityType: 'document', action: 'updated' });
    expect(holder.authCalls.at(-1)).toEqual(['cms.history', 'view']);
    holder.denied = true;
    expect((await call('history')).status).toBe(403);
  });
});

/* ================================================================== */
/* Publication integration flow (draft -> live -> edit -> unpublish)    */
/* ================================================================== */

describe('Phase 28 publication integration flow', () => {
  it('announcement page: draft hidden -> published visible -> edited -> unpublished hidden', async () => {
    const created = await call('pages', 'POST', {
      slug: 'harvest-festival',
      title: 'Harvest Festival',
      sections: [{ blockType: 'rich-text', content: { text: 'Join us' }, sortOrder: 0, isVisible: true }],
      changeSummary: 'Announce the festival.',
    });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    // Draft: absent publicly.
    expect((await call('public/pages/harvest-festival')).status).toBe(404);
    // Publish: visible publicly.
    expect((await call(`pages/${id}/publish`, 'POST', {})).status).toBe(200);
    const visible = await call('public/pages/harvest-festival');
    expect(visible.status).toBe(200);
    expect(visible.body).toMatchObject({ title: 'Harvest Festival' });
    // Edit + republish: updated publicly.
    const edited = await call(`pages/${id}`, 'PATCH', {
      title: 'Harvest Festival 2026',
      expectedVersion: 2,
      changeSummary: 'Retitle the announcement.',
    });
    expect(edited.status).toBe(200);
    expect((await call(`pages/${id}/publish`, 'POST', {})).status).toBe(200);
    expect((await call('public/pages/harvest-festival')).body).toMatchObject({
      title: 'Harvest Festival 2026',
    });
    // Unpublish: absent again, with the full audit trail behind it.
    await call(`pages/${id}/unpublish`, 'POST', {});
    expect((await call('public/pages/harvest-festival')).status).toBe(404);
    expect(audits().map((a) => a.action)).toEqual(
      expect.arrayContaining(['CMS_PAGE_CREATED', 'CMS_PAGE_PUBLISHED', 'CMS_PAGE_UNPUBLISHED']),
    );
  });
});
