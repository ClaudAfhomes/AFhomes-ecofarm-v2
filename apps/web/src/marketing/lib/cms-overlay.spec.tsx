/**
 * Phase 28 - public CMS overlay integration.
 *
 * Proves the publication flow the public website actually runs: static
 * repository fallbacks render first, `hydrateCms()` overlays only
 * structurally valid published documents, malformed or failed hydration
 * keeps the fallbacks, archived items stay hidden, and the generic page
 * route serves visible published sections while drafting/unknown slugs land
 * on a safe 404. Media-block (gallery) content flows through the same overlay.
 */
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';

import { renderWithProviders } from '../../test/utils';
import { stories } from '../data/mock/stories';
import { siteConfig } from '../data/mock/site';
import { Footer } from '../components/layout/Footer';
import Home from '../pages/Home';
import Contact from '../pages/Contact';
import CmsPage from '../pages/CmsPage';

function mockApi(handler: (url: string) => { status: number; body: unknown } | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const route = handler(url);
      if (!route) {
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'nope' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(route.body), {
        status: route.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

const docsResponse = (documents: Record<string, unknown>) => ({
  status: 200,
  body: { documents, revision: '2026-10-02T00:00:00.000Z' },
});

async function freshCms(documents: Record<string, unknown> | 'fail') {
  vi.resetModules();
  if (documents === 'fail') {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
  } else {
    mockApi((url) => (url.includes('/cms/public') ? docsResponse(documents) : null));
  }
  const cms = await import('./cms');
  await cms.hydrateCms();
  return cms;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

/* ================================================================== */
/* Overlay semantics                                                   */
/* ================================================================== */

describe('Phase 28 CMS overlay', () => {
  it('26. live CMS overrides the fallback when present', async () => {
    const cms = await freshCms({
      site: { ...siteConfig, businessName: 'AF Homes CMS Edition' },
    });
    expect(cms.cmsRepository.getSiteConfig().businessName).toBe('AF Homes CMS Edition');
    // Keys the CMS did not publish keep their repository values.
    expect(cms.cmsRepository.getStories().length).toBeGreaterThan(0);
  });

  it('6/25. drafts (absent keys) and malformed documents keep the fallback', async () => {
    const cms = await freshCms({ stories: { title: 42 } });
    expect(cms.cmsRepository.getStories()).toEqual(stories);
    const empty = await freshCms({});
    expect(empty.cmsRepository.getSiteConfig()).toEqual(siteConfig);
  });

  it('keeps the fallback when the CMS request fails', async () => {
    const cms = await freshCms('fail');
    expect(cms.cmsRepository.getSiteConfig()).toEqual(siteConfig);
    expect(cms.cmsRepository.getStories()).toEqual(stories);
  });

  it('hides archived stories publicly while live ones render', async () => {
    const live = { ...stories[0]!, slug: 'cms-live', archived: false };
    const retired = { ...stories[0]!, slug: 'cms-retired', archived: true };
    const cms = await freshCms({ stories: [live, retired] });
    const visible = cms.cmsRepository.getStories();
    expect(visible.map((s) => s.slug)).toEqual(['cms-live']);
  });

  it('flows gallery media blocks through the same overlay', async () => {
    const block = {
      id: 'm1',
      page: '/',
      placement: 'after-page',
      kind: 'image',
      src: 'https://cdn.test/gallery/lagoon.jpg',
      alt: 'Lagoon',
      caption: 'Lagoon at dusk',
      width: 'wide',
      fit: 'cover',
    };
    const cms = await freshCms({ mediaBlocks: [block] });
    expect(cms.cmsRepository.getMediaBlocks()).toEqual([block]);
  });
});

/* ================================================================== */
/* Generic page route                                                  */
/* ================================================================== */

const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const SECTION_A = '22222222-2222-4222-8222-222222222222';
const SECTION_B = '33333333-3333-4333-8333-333333333333';
const snapshot = (over: Record<string, unknown> = {}) => ({
  id: PAGE_ID,
  slug: 'visit-us',
  title: 'Visit Us',
  status: 'published',
  seo: { title: '', description: '', openGraphTitle: '', openGraphDescription: '', openGraphImage: '' },
  sections: [
    { id: SECTION_A, blockType: 'hero', content: { title: 'Hello' }, sortOrder: 0, isVisible: true },
    { id: SECTION_B, blockType: 'rich-text', content: { text: 'Staff notes' }, sortOrder: 1, isVisible: false },
  ],
  version: 2,
  publishedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...over,
});

function renderSlug(slug: string) {
  return renderWithProviders(
    (
      <Routes>
        <Route path=":slug" element={<CmsPage />} />
      </Routes>
    ),
    { route: `/${slug}` },
  );
}

describe('Phase 28 public page route', () => {
  beforeEach(() => {
    mockApi((url) => {
      // The mock mirrors the server: only visible sections leave the API.
      if (url.includes('/cms/public/pages/visit-us')) {
        const full = snapshot();
        return {
          status: 200,
          body: { ...full, sections: (full.sections as unknown[]).filter((s) => (s as { isVisible: boolean }).isVisible) },
        };
      }
      return null;
    });
  });

  it('renders published sections (the API filters invisible ones)', async () => {
    renderSlug('visit-us');
    expect(await screen.findByText('Visit Us')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('45. lands drafts and unknown slugs on a safe 404', async () => {
    renderSlug('retired-page');
    expect(await screen.findByText('This page is taking a rest day.')).toBeInTheDocument();
  });

  it('33. neutralizes hostile CMS URLs at the render boundary', async () => {
    mockApi((url) => {
      if (!url.includes('/cms/public/pages/')) return null;
      return {
        status: 200,
        body: snapshot({
          sections: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              blockType: 'cta',
              content: { title: 'Deal', href: 'javascript:alert(1)', label: 'Claim' },
              sortOrder: 0,
              isVisible: true,
            },
            {
              id: '55555555-5555-4555-8555-555555555555',
              blockType: 'image',
              content: { url: 'data:image/svg+xml,<svg onload=alert(1)>', alt: 'x' },
              sortOrder: 1,
              isVisible: true,
            },
          ],
        }),
      };
    });
    const { container } = renderSlug('visit-us');
    const link = await screen.findByRole('link', { name: 'Claim' });
    expect(link.getAttribute('href')).toBe('#');
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });
});

/* ================================================================== */
/* Public routes keep rendering (42/43/44)                             */
/* ================================================================== */

describe('Phase 28 public routes', () => {
  beforeEach(() => {
    // framer-motion Reveal observes the viewport; jsdom has no such API.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    window.scrollTo = vi.fn() as never;
    mockApi((url) => (url.includes('/cms/public') && !url.includes('/pages/') ? docsResponse({}) : null));
  });

  it('42. the homepage still renders on fallbacks', async () => {
    renderWithProviders(<Home />);
    // The hero animates per-word spans joined by non-breaking spaces.
    const heading = await screen.findByRole('heading', { level: 1 });
    const text = (heading.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toMatch(/Amazing.*Fun.*Your Home Away From Home/s);
  });

  it('43. the contact page still renders CMS contact data', async () => {
    renderWithProviders(<Contact />);
    expect(await screen.findByText(siteConfig.email)).toBeInTheDocument();
  });

  it('44. gallery blocks render from live CMS media', async () => {
    vi.resetModules();
    mockApi((url) =>
      url.includes('/cms/public')
        ? docsResponse({
            mediaBlocks: [
              {
                id: 'm1',
                page: '/',
                placement: 'after-page',
                kind: 'image',
                src: 'https://cdn.test/gallery/lagoon.jpg',
                alt: 'Lagoon',
                caption: 'Lagoon at dusk',
                width: 'wide',
                fit: 'cover',
              },
            ],
          })
        : null,
    );
    const cms = await import('./cms');
    await cms.hydrateCms();
    // The component must bind the hydrated module instance, not the static
    // import evaluated before `vi.resetModules()`.
    const { CmsMediaSections: LiveSections } = await import('../components/ui/CmsMediaSections');
    renderWithProviders(<LiveSections page="/" placement="after-page" />);
    expect(await screen.findByText('Lagoon at dusk')).toBeInTheDocument();
  });

  it('the footer reads contact data with sanitized links', async () => {
    renderWithProviders(<Footer />);
    expect(await screen.findByText(siteConfig.email)).toBeInTheDocument();
    for (const anchor of document.querySelectorAll('footer a[href]')) {
      expect(anchor.getAttribute('href')).not.toMatch(/^javascript:/i);
    }
  });
});
