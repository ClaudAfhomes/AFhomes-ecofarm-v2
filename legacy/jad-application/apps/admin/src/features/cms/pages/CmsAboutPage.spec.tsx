import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MOCK_MEMBER, MOCK_SUPER_ADMIN } from '@jad/mock';
import { aboutContentSchema } from '@jad/contracts';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { CmsAboutPage } from './CmsAboutPage';
import {
  __getAboutSeed,
  __resetAboutForTests,
  __resetCmsForTests,
  getAbout,
} from '../services/cmsRepository';

function renderAbout(route = '/admin/cms/about', user = MOCK_SUPER_ADMIN) {
  return renderWithProviders(<CmsAboutPage />, { route, user });
}

describe('CmsAboutPage - Phase 2 About CMS', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    __resetAboutForTests();
    __resetCmsForTests();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
    vi.restoreAllMocks();
  });

  it('SUPER_ADMIN can access About CMS', async () => {
    renderAbout('/admin/cms/about', MOCK_SUPER_ADMIN);
    expect(await screen.findByText('About CMS')).toBeInTheDocument();
    expect(screen.getByText(/Manage the public About page/)).toBeInTheDocument();
  });

  it('MEMBER cannot access About CMS (Forbidden)', async () => {
    const { RequireRole } = await import('../../../app/RequireRole');
    const { MemoryRouter, Route, Routes } = await import('react-router');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    render(
      <SessionProvider initialUser={MOCK_MEMBER as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/about']}>
            <Routes>
              <Route
                path="/admin/cms/about"
                element={
                  <RequireRole>
                    <CmsAboutPage />
                  </RequireRole>
                }
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </SessionProvider>,
    );
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('unauthenticated user is redirected to VITE_WEB_URL/login', async () => {
    const { RequireRole, getValidatedWebLoginUrl } = await import('../../../app/RequireRole');
    const { MemoryRouter, Route, Routes } = await import('react-router');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    expect(getValidatedWebLoginUrl()).toMatch(/\/login$/);
    expect(getValidatedWebLoginUrl()).toContain('5173');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    render(
      <SessionProvider initialUser={null as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/about']}>
            <Routes>
              <Route
                path="/admin/cms/about"
                element={
                  <RequireRole>
                    <CmsAboutPage />
                  </RequireRole>
                }
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </SessionProvider>,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
    expect(screen.queryByText('About CMS')).not.toBeInTheDocument();
  });

  it('renders all seven About sections', async () => {
    renderAbout();
    expect(await screen.findByRole('heading', { name: 'Hero' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Who We Are' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Philosophy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Our Approach' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vision' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mission' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CTA Band' })).toBeInTheDocument();
  });

  it('initial CMS values match public ABOUT content (alignment)', async () => {
    const seed = __getAboutSeed();
    expect(seed.hero.title).toBe('About JA&D Realty Services');
    expect(seed.hero.eyebrow).toBe('About');
    expect(seed.hero.primaryCta).toEqual({ label: 'Explore Properties', to: '/properties' });
    expect(seed.hero.image).toEqual({
      id: 'photo-1512917774080-9991f1c4c750',
      alt: 'A modern home exterior with warm lighting at dusk',
    });
    expect(seed.intro.title).toBe('Property that already works.');
    expect(seed.intro.paragraphs).toHaveLength(2);
    expect(seed.philosophy.items).toHaveLength(3);
    expect(seed.philosophy.items[0]?.title).toBe('Judicious Advisory & Diligence');
    expect(seed.approach.points).toHaveLength(3);
    expect(seed.approach.points[0]?.title).toBe('Due diligence first');
    expect(seed.vision.statement).toContain('To be the brokerage that Filipinos');
    expect(seed.mission.points).toHaveLength(3);
    expect(seed.mission.points[0]?.title).toBe('Connect buyers and sellers');
    expect(seed.cta.title).toBe('See how the approach works');
    expect(seed.cta.primaryCta).toEqual({ label: 'Explore Properties', to: '/properties' });
    expect(seed.cta.secondaryCta).toEqual({ label: 'Talk to Us', to: '/contact' });

    const viaRepo = await getAbout();
    expect(viaRepo).toEqual(seed);
  });

  it('cms schema validates the seed', async () => {
    const seed = __getAboutSeed();
    const parsed = aboutContentSchema.safeParse(seed);
    expect(parsed.success).toBe(true);
  });

  it('allows text editing and reflects in preview', async () => {
    const user = userEvent.setup();
    renderAbout();
    await screen.findByRole('heading', { name: 'Hero' });
    expect(screen.getByDisplayValue('About JA&D Realty Services')).toBeInTheDocument();
    const titleInput = screen.getByDisplayValue('About JA&D Realty Services') as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'New About Title');
    expect(screen.getByDisplayValue('New About Title')).toBeInTheDocument();
    expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0);
    expect(screen.getByText('Save')).toBeEnabled();
  });

  it('allows paragraph editing', async () => {
    const user = userEvent.setup();
    renderAbout();
    await screen.findByRole('heading', { name: 'Hero' });
    // Who We Are is collapsed - expand it
    await user.click(screen.getByRole('button', { name: /Who We Are/ }));
    const para = screen.getByDisplayValue(/JA&D Realty Services is a real-estate brokerage/);
    await user.clear(para);
    await user.type(para, 'Custom paragraph for testing.');
    expect(screen.getByDisplayValue('Custom paragraph for testing.')).toBeInTheDocument();
  });

  it('allows pillar editing', async () => {
    const user = userEvent.setup();
    renderAbout();
    await screen.findByRole('heading', { name: 'Hero' });
    await user.click(screen.getByRole('button', { name: /Philosophy/ }));
    const pillar = screen.getByDisplayValue('Judicious Advisory & Diligence');
    await user.clear(pillar);
    await user.type(pillar, 'Updated Pillar Title');
    expect(screen.getByDisplayValue('Updated Pillar Title')).toBeInTheDocument();
  });

  it('image/alt editing', async () => {
    const user = userEvent.setup();
    renderAbout();
    await screen.findByRole('heading', { name: 'Hero' });
    const altInput = screen.getByDisplayValue('A modern home exterior with warm lighting at dusk');
    await user.clear(altInput);
    await user.type(altInput, 'Custom alt for about hero');
    expect(screen.getByDisplayValue('Custom alt for about hero')).toBeInTheDocument();
  });

  it('CTA editing', async () => {
    const user = userEvent.setup();
    renderAbout();
    await screen.findByRole('heading', { name: 'Hero' });
    const ctaLabel = screen.getAllByDisplayValue('Explore Properties')[0]!;
    await user.clear(ctaLabel);
    await user.type(ctaLabel, 'Browse Listings');
    expect(screen.getByDisplayValue('Browse Listings')).toBeInTheDocument();
  });

  it('dirty state: Cancel restores, Save updates local state', async () => {
    const user = userEvent.setup();
    renderAbout();
    await screen.findByRole('heading', { name: 'Hero' });
    const titleInput = screen.getByDisplayValue('About JA&D Realty Services');
    await user.clear(titleInput);
    await user.type(titleInput, 'Dirty About Title');
    await user.click(screen.getByText('Cancel'));
    expect(await screen.findByText('Discard changes?')).toBeInTheDocument();
    await user.click(screen.getByText('Discard'));
    expect(screen.getByDisplayValue('About JA&D Realty Services')).toBeInTheDocument();
    expect(screen.queryByText('Dirty About Title')).not.toBeInTheDocument();

    const restored = screen.getByDisplayValue('About JA&D Realty Services') as HTMLInputElement;
    await user.clear(restored);
    await user.type(restored, 'Saved About Title');
    await user.click(screen.getByText('Save'));
    expect((await screen.findAllByText(/All changes saved/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Saved About Title')).toBeInTheDocument();
  });

  it('validation: empty required title shows error and disables Save', async () => {
    const user = userEvent.setup();
    renderAbout();
    await screen.findByRole('heading', { name: 'Hero' });
    const titleInput = screen.getByDisplayValue('About JA&D Realty Services');
    await user.clear(titleInput);
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('CTA URL validation rejects unsafe schemes', async () => {
    const parsed = aboutContentSchema.safeParse({
      ...__getAboutSeed(),
      hero: { ...__getAboutSeed().hero, primaryCta: { label: 'Bad', href: 'javascript:alert(1)' } },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('http'))).toBe(true);
    }
  });

  it('editing vision statement updates the form value (preview-free)', async () => {
    const user = userEvent.setup();
    renderAbout();
    await screen.findByRole('heading', { name: 'Hero' });
    // Vision is collapsed - expand it
    await user.click(screen.getByRole('button', { name: /Vision/ }));
    const visionInput = screen.getByDisplayValue(/To be the brokerage that Filipinos/);
    await user.clear(visionInput);
    await user.type(visionInput, 'Updated Vision Statement');
    expect(screen.getByDisplayValue('Updated Vision Statement')).toBeInTheDocument();
    expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0);
  });

  it('shows All changes saved, not Published', async () => {
    renderAbout();
    await screen.findByRole('heading', { name: 'Hero' });
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('Website CMS navigation includes About as active (not Coming soon)', async () => {
    const { ADMIN_NAV_ITEMS, canAccess } = await import('../../../app/navigation');
    const cmsItem = ADMIN_NAV_ITEMS.find((i) => i.to === '/admin/cms');
    expect(
      cmsItem?.dropdown?.some(
        (d) => !('divider' in d) && d.to === '/admin/cms/about' && d.label === 'About',
      ),
    ).toBe(true);
    expect(
      cmsItem?.dropdown?.some(
        (d) => !('divider' in d) && d.label.includes('Coming soon') && d.to === '/admin/cms/about',
      ),
    ).toBe(false);
    expect(canAccess(MOCK_SUPER_ADMIN.role as never, cmsItem!)).toBe(true);
  });

  it('Homepage CMS remains functional after About implementation', async () => {
    const { CmsHomepagePage } = await import('../pages/CmsHomepagePage');
    const { render } = await import('@testing-library/react');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    const { MemoryRouter } = await import('react-router');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <SessionProvider initialUser={MOCK_SUPER_ADMIN as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/homepage']}>
            <CmsHomepagePage />
          </MemoryRouter>
        </QueryClientProvider>
      </SessionProvider>,
    );
    expect(await screen.findByText('Homepage CMS')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Hero' })).toBeInTheDocument();
  });
});
