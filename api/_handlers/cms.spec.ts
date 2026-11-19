import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const STAFF = '00000000-0000-4000-8000-0000000000aa';
const holder = vi.hoisted(() => ({ db: null as unknown, denied: false }));

vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db }));
vi.mock('../_lib/afhomes-access.js', () => ({
  authorizeAfHomes: async () =>
    holder.denied
      ? { error: { status: 403, error: { code: 'FORBIDDEN', message: 'Missing permission' } } }
      : { userId: STAFF },
}));

const { default: handler } = await import('./cms.js');

const tables = () => ({
  cms_documents: [
    {
      key: 'stories',
      draft_value: [{ title: 'Draft only' }],
      published_value: [{ title: 'Published' }],
      status: 'published',
      version: 2,
      published_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
      created_by: STAFF,
      updated_by: STAFF,
    },
    {
      key: 'experiences',
      draft_value: [{ title: 'Hidden draft' }],
      published_value: null,
      status: 'draft',
      version: 1,
      published_at: null,
      updated_at: '2026-10-01T00:00:00.000Z',
      created_by: STAFF,
      updated_by: STAFF,
    },
  ],
  cms_document_versions: [],
  audit_events: [],
});

async function call(path: string, method = 'GET', body?: unknown) {
  const { res, state } = makeRes();
  await handler(makeReq({ method, body, query: { familyPath: path } }) as never, res as never);
  return state;
}

describe('Phase 6 CMS handler', () => {
  beforeEach(() => {
    holder.denied = false;
    holder.db = new FakeSupabase({ tables: tables() });
  });

  it('public content returns published snapshots and never draft-only content', async () => {
    const result = await call('public');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ documents: { stories: [{ title: 'Published' }] } });
    expect(JSON.stringify(result.body)).not.toContain('Draft only');
    expect(JSON.stringify(result.body)).not.toContain('Hidden draft');
  });

  it('denies an unauthorized staff document mutation with 403 and writes nothing', async () => {
    holder.denied = true;
    const result = await call('documents/stories', 'PATCH', {
      value: [],
      expectedVersion: 2,
      changeSummary: 'Remove stories',
    });
    expect(result.status).toBe(403);
    expect((holder.db as FakeSupabase).rows('cms_documents')[0]!.version).toBe(2);
    expect((holder.db as FakeSupabase).rows('audit_events')).toHaveLength(0);
  });

  it('allows an authorized principal to update a draft with optimistic versioning and audit', async () => {
    const result = await call('documents/stories', 'PATCH', {
      value: [{ title: 'Next' }],
      expectedVersion: 2,
      changeSummary: 'Refresh stories',
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      key: 'stories',
      version: 3,
      draftValue: [{ title: 'Next' }],
    });
    expect((holder.db as FakeSupabase).rows('cms_document_versions')).toHaveLength(1);
    expect((holder.db as FakeSupabase).rows('audit_events')).toHaveLength(1);
  });

  it('rejects a stale update instead of overwriting a newer draft', async () => {
    const result = await call('documents/stories', 'PATCH', {
      value: [],
      expectedVersion: 1,
      changeSummary: 'Stale edit',
    });
    expect(result.status).toBe(409);
    expect((holder.db as FakeSupabase).rows('cms_document_versions')).toHaveLength(0);
  });
});
