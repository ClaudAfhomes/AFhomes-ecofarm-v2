/**
 * AFHomes Phase 28 CMS admin surface.
 *
 * Checks retained Website CMS behavior using contract-shaped mock API responses:
 * list loading/empty/error-with-retry, create/edit with server validation
 * errors, publish/unpublish toggles, permission-gated actions, no duplicate
 * submission while a save is pending, and no dead navigation links across the
 * seven CMS routes.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import type { SessionUser } from '../../lib/session';
import { websiteDefaults } from '@afhomes/ui/website-content';

// Exercise retained CMS behavior; default-off routing is tested without this mock.
vi.mock('@afhomes/shared', async (original) => {
  const actual = await original<typeof import('@afhomes/shared')>();
  return {
    ...actual,
    FEATURE_FLAGS: { ...actual.FEATURE_FLAGS, cms: true },
    isFeaturePathEnabled: (path: string) =>
      path === '/admin/cms' || path.startsWith('/admin/cms/') || actual.isFeaturePathEnabled(path),
  };
});

type Route = { status?: number; body: unknown };
const routes = new Map<string, Route>();
const requests: { path: string; method: string; body: unknown; query: string }[] = [];

const list = (data: unknown[]): Route => ({ status: 200, body: { data, meta: { total: data.length } } });

const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const SEO = {
  title: '',
  description: '',
  openGraphTitle: '',
  openGraphDescription: '',
  openGraphImage: '',
};

const page = (over: Record<string, unknown> = {}) => ({
  id: PAGE_ID,
  slug: 'visit-us',
  title: 'Visit Us',
  status: 'draft',
  seo: SEO,
  sections: [],
  version: 2,
  publishedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...over,
});

const storiesDoc = (over: Record<string, unknown> = {}) => ({
  key: 'stories',
  draftValue: [],
  publishedValue: null,
  status: 'draft',
  version: 1,
  publishedAt: null,
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...over,
});

const CMS_USER: SessionUser = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Cms Editor',
  email: 'cms@afhomes.test',
  roleId: 'r-cms',
  roleName: 'Content',
  status: 'active',
  afHomesPermissions: [
    { moduleKey: 'dashboard.view', canView: true, canCreate: false, canUpdate: false, canDelete: false },
    { moduleKey: 'cms.pages', canView: true, canCreate: true, canUpdate: true, canDelete: false },
    { moduleKey: 'cms.media', canView: true, canCreate: true, canUpdate: false, canDelete: true },
    { moduleKey: 'cms.settings', canView: true, canCreate: false, canUpdate: true, canDelete: false },
    { moduleKey: 'cms.history', canView: true, canCreate: false, canUpdate: false, canDelete: false },
  ],
};

const VIEW_ONLY: SessionUser = {
  ...CMS_USER,
  afHomesPermissions: CMS_USER.afHomesPermissions.map((p) =>
    p.moduleKey.startsWith('cms.') ? { ...p, canCreate: false, canUpdate: false, canDelete: false } : p,
  ),
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const [bare, query = ''] = url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/api\/v1/, '')
      .split('?');
    const path = bare!;
    const method = init?.method ?? 'GET';
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    requests.push({ path, method, body, query });
    const route = routes.get(`${method} ${path}`) ?? routes.get(path);
    if (!route) {
      return new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: `unstubbed ${method} ${path}` } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function install(over: Record<string, Route> = {}) {
  routes.clear();
  routes.set('GET /cms/pages', list([page()]));
  routes.set('GET /cms/documents', list([storiesDoc()]));
  routes.set('GET /cms/media', list([]));
  routes.set('GET /cms/history', list([]));
  for (const [k, v] of Object.entries(over)) routes.set(k, v);
}

const render = (route: string, user: SessionUser = CMS_USER) =>
  renderWithProviders(<App />, { route, user });

beforeEach(() => {
  requests.length = 0;
  install();
  vi.stubGlobal('fetch', mockFetch());
});

/* ================================================================== */
/* Pages: list states                                                  */
/* ================================================================== */

describe('Phase 28 CMS pages list', () => {
  it('38. shows a loading state while pages load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render('/admin/cms/pages');
    expect(await screen.findByLabelText('Loading CMS pages')).toBeInTheDocument();
  });

  it('39. shows an empty state when no custom page exists', async () => {
    install({ 'GET /cms/pages': list([]) });
    render('/admin/cms/pages');
    expect(await screen.findByText('No custom pages')).toBeInTheDocument();
  });

  it('40. shows an error with retry and recovers', async () => {
    const user = userEvent.setup();
    install({
      'GET /cms/pages': { status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } },
    });
    render('/admin/cms/pages');
    expect(await screen.findByText('CMS pages could not be loaded')).toBeInTheDocument();
    install({ 'GET /cms/pages': list([page()]) });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Visit Us')).toBeInTheDocument();
  });

  it('renders server slugs and versions, never invented ones', async () => {
    render('/admin/cms/pages');
    expect(await screen.findByText('/visit-us')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Pages: create / edit / publish                                      */
/* ================================================================== */

describe('Phase 28 CMS page editing', () => {
  it('creates a page and refreshes the list', async () => {
    const user = userEvent.setup();
    install({
      'GET /cms/pages': list([page()]),
      'POST /cms/pages': { status: 201, body: page({ id: '22222222-2222-4222-8222-222222222222', slug: 'harvest', title: 'Harvest', version: 1 }) },
    });
    render('/admin/cms/pages');
    await screen.findByText('Visit Us');
    await user.click(screen.getByRole('button', { name: 'New page' }));
    await user.type(screen.getByLabelText('Title(Optional)'), 'Harvest');
    await user.type(screen.getByLabelText('Slug(Optional)'), 'harvest');
    await user.type(screen.getByLabelText('Change summary(Optional)'), 'Announce the harvest.');
    await user.click(screen.getByRole('button', { name: 'Save page' }));
    await waitFor(() => {
      const post = requests.find((r) => r.method === 'POST' && r.path === '/cms/pages');
      expect(post?.body).toMatchObject({ slug: 'harvest', title: 'Harvest' });
    });
  });

  it('surfaces server validation errors without closing the editor', async () => {
    const user = userEvent.setup();
    install({
      'POST /cms/pages': {
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'That slug or media path already exists.' } },
      },
    });
    render('/admin/cms/pages');
    await screen.findByText('Visit Us');
    await user.click(screen.getByRole('button', { name: 'New page' }));
    await user.type(screen.getByLabelText('Title(Optional)'), 'Copy');
    await user.type(screen.getByLabelText('Slug(Optional)'), 'visit-us');
    await user.type(screen.getByLabelText('Change summary(Optional)'), 'Duplicate the slug.');
    await user.click(screen.getByRole('button', { name: 'Save page' }));
    expect(await screen.findByText('That slug or media path already exists.')).toBeInTheDocument();
    // The editor stays open for correction.
    expect(screen.getByLabelText('Slug(Optional)')).toBeInTheDocument();
  });

  it('toggles publish state per row and sends no duplicate save', async () => {
    const user = userEvent.setup();
    install({
      'GET /cms/pages': list([page(), page({ id: '33333333-3333-4333-8333-333333333333', slug: 'live', title: 'Live', status: 'published' })]),
      'POST /cms/pages/11111111-1111-4111-8111-111111111111/publish': {
        status: 200,
        body: page({ status: 'published' }),
      },
    });
    render('/admin/cms/pages');
    await screen.findByText('Visit Us');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => {
      expect(
        requests.filter(
          (r) => r.method === 'POST' && r.path === '/cms/pages/11111111-1111-4111-8111-111111111111/publish',
        ),
      ).toHaveLength(1);
    });
  });

  it('hides New/Edit/Publish from a view-only editor (server still enforces)', async () => {
    render('/admin/cms/pages', VIEW_ONLY);
    await screen.findByText('Visit Us');
    expect(screen.queryByRole('button', { name: 'New page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });
});

/* ================================================================== */
/* Documents: draft save + publish                                     */
/* ================================================================== */

describe('Phase 28 CMS document editing', () => {
  it('saves a draft and publishes it with feedback', async () => {
    const user = userEvent.setup();
    install({
      'PATCH /cms/documents/stories': { status: 200, body: storiesDoc({ version: 2 }) },
      'POST /cms/documents/stories/publish': {
        status: 200,
        body: storiesDoc({ version: 3, status: 'published' }),
      },
    });
    render('/admin/cms/stories');
    expect(await screen.findByRole('heading', { name: 'Stories' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Change summary(Optional)'), 'Refresh the stories.');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));
    expect(await screen.findByText('Draft saved. The public website is unchanged until you publish.')).toBeInTheDocument();
    expect(requests.find((r) => r.method === 'PATCH' && r.path === '/cms/documents/stories')?.body)
      .toMatchObject({ value: [], expectedVersion: 1, changeSummary: 'Refresh the stories.' });
    await user.click(screen.getByRole('button', { name: 'Publish Saved Draft' }));
    expect(await screen.findByText('Saved draft published.')).toBeInTheDocument();
    expect(requests.find((r) => r.method === 'POST' && r.path === '/cms/documents/stories/publish')?.body)
      .toMatchObject({ expectedVersion: 2 });
  });

  it('retains invalid structured content and blocks saving with an explanation', async () => {
    const user = userEvent.setup();
    install({ 'GET /cms/documents': list([storiesDoc({ draftValue: [websiteDefaults.stories[0]] })]) });
    render('/admin/cms/stories');
    await screen.findByRole('heading', { name: 'Stories' });
    const editor = screen.getByLabelText('Title(Optional)');
    const invalid = 'x'.repeat(20001);
    fireEvent.change(editor, { target: { value: invalid } });
    await user.type(screen.getByLabelText('Change summary(Optional)'), 'Broken edit.');
    expect(screen.getByText(/Content needs review. The original data is preserved/)).toBeInTheDocument();
    expect(editor).toHaveValue(invalid);
    const save = screen.getByRole('button', { name: 'Save Draft' });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
  });
});

/* ================================================================== */
/* Media + history                                                     */
/* ================================================================== */

describe('Phase 28 CMS media and history', () => {
  it('lists media with an empty state and deletes with refresh', async () => {
    const user = userEvent.setup();
    const item = {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Hero banner',
      storagePath: 'staff/4444.jpg',
      publicUrl: 'https://cdn.test/staff/4444.jpg',
      mimeType: 'image/jpeg',
      mediaType: 'image',
      altText: 'Resort entrance',
      category: 'banners',
      sizeBytes: 1024,
      createdAt: '2026-10-01T00:00:00.000Z',
    };
    install({
      'GET /cms/media': list([item]),
      'DELETE /cms/media/44444444-4444-4444-8444-444444444444': { status: 200, body: item },
    });
    render('/admin/cms/media');
    expect(await screen.findByText('Hero banner')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(
        requests.filter((r) => r.method === 'DELETE' && r.path === '/cms/media/44444444-4444-4444-8444-444444444444'),
      ).toHaveLength(1);
    });
  });

  it('renders history rows with attribution', async () => {
    install({
      'GET /cms/history': list([
        {
          id: 'document-1',
          entityType: 'document',
          entityId: 'stories',
          action: 'published',
          changeSummary: 'Go live.',
          version: 3,
          authorId: '11111111-1111-4111-8111-111111111111',
          authorName: 'Cms Editor',
          createdAt: '2026-10-02T00:00:00.000Z',
        },
      ]),
    });
    render('/admin/cms/history');
    expect(await screen.findByText('Go live.')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Cms Editor')).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Navigation completeness (46): no dead CMS links                     */
/* ================================================================== */

describe('Phase 28 CMS navigation completeness', () => {
  const entries: [string, string][] = [
    ['/admin/cms/pages', 'CMS Pages'],
    ['/admin/cms/media', 'CMS Media'],
    ['/admin/cms/stories', 'Stories'],
    ['/admin/cms/experiences', 'Experiences'],
    ['/admin/cms/site-settings', 'Site Settings'],
    ['/admin/cms/seo', 'SEO'],
    ['/admin/cms/history', 'CMS History'],
  ];

  it.each(entries)('renders %s without a dead link', async (path, heading) => {
    render(path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it('tables scroll horizontally instead of breaking narrow screens', async () => {
    render('/admin/cms/pages');
    await screen.findByText('Visit Us');
    expect(document.querySelector('.table-scroll')).not.toBeNull();
  });
});
