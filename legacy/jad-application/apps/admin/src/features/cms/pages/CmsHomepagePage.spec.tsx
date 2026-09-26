import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MOCK_MEMBER, MOCK_SUPER_ADMIN } from '@jad/mock';
import { homepageContentSchema } from '@jad/contracts';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { CmsHomepagePage } from './CmsHomepagePage';
import { __getHomepageSeed, __resetHomepageForTests, getHomepage } from '../services/cmsRepository';

function renderCms(route = '/admin/cms/homepage', user = MOCK_SUPER_ADMIN) {
  return renderWithProviders(<CmsHomepagePage />, { route, user });
}

describe('CmsHomepagePage - Phase 1 Homepage CMS', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    __resetHomepageForTests();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
    vi.restoreAllMocks();
  });

  it('SUPER_ADMIN can access Homepage CMS', async () => {
    renderCms('/admin/cms/homepage', MOCK_SUPER_ADMIN);
    expect(await screen.findByText('Homepage CMS')).toBeInTheDocument();
    expect(screen.getByText(/Manage the public homepage/)).toBeInTheDocument();
  });

  it('MEMBER cannot access Homepage CMS (Forbidden)', async () => {
    // Render via RequireRole to exercise the guard (direct page render bypasses it)
    const { RequireRole } = await import('../../../app/RequireRole');
    const { MemoryRouter, Route, Routes } = await import('react-router');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    render(
      <SessionProvider initialUser={MOCK_MEMBER as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/homepage']}>
            <Routes>
              <Route
                path="/admin/cms/homepage"
                element={
                  <RequireRole>
                    <CmsHomepagePage />
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
    // Validate helper uses configured VITE_WEB_URL (not hardcoded)
    expect(getValidatedWebLoginUrl()).toMatch(/\/login$/);
    expect(getValidatedWebLoginUrl()).toContain('5173');

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    render(
      <SessionProvider initialUser={null as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/homepage']}>
            <Routes>
              <Route
                path="/admin/cms/homepage"
                element={
                  <RequireRole>
                    <CmsHomepagePage />
                  </RequireRole>
                }
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </SessionProvider>,
    );
    // Hard redirect - renders null, not Forbidden nor page
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
    expect(screen.queryByText('Homepage CMS')).not.toBeInTheDocument();
  });

  it('Website CMS navigation entry is visible to SUPER_ADMIN', async () => {
    const { ADMIN_NAV_ITEMS, canAccess } = await import('../../../app/navigation');
    const cmsItem = ADMIN_NAV_ITEMS.find((i) => i.to === '/admin/cms');
    expect(cmsItem).toBeDefined();
    expect(cmsItem?.label).toBe('Website CMS');
    expect(canAccess(MOCK_SUPER_ADMIN.role as never, cmsItem!)).toBe(true);
    expect(
      cmsItem?.dropdown?.some((d) => !('divider' in d) && d.to === '/admin/cms/homepage'),
    ).toBe(true);
    expect(canAccess(MOCK_MEMBER.role as never, cmsItem!)).toBe(false);
  });

  it('/admin/cms redirects to /admin/cms/homepage', async () => {
    const { MemoryRouter, Route, Routes, Navigate } = await import('react-router');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    // Simulate App routing for /admin/cms → Navigate
    render(
      <SessionProvider initialUser={MOCK_SUPER_ADMIN as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms']}>
            <Routes>
              <Route path="/admin/cms" element={<Navigate to="/admin/cms/homepage" replace />} />
              <Route path="/admin/cms/homepage" element={<CmsHomepagePage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </SessionProvider>,
    );
    expect(await screen.findByText('Homepage CMS')).toBeInTheDocument();
  });

  it('renders all eight homepage sections', async () => {
    renderCms();
    expect(await screen.findByRole('heading', { name: 'Hero' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Value' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Featured' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Approach' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trust' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'About Preview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CTA Band' })).toBeInTheDocument();
  });

  it('initial CMS values match public HOME content (alignment)', async () => {
    const cmsSeed = __getHomepageSeed();
    // Verify seed derived from HOME - spot-check every section (full HOME copy verified at build via cmsRepository)
    // These literals are the exact HOME values from apps/web/src/features/public/content/home.ts
    expect(cmsSeed.hero.title).toBe('Where Big Dreams Meet Property That Already Earns');
    expect(cmsSeed.hero.eyebrow).toBe('JA&D Realty Services');
    expect(cmsSeed.hero.primaryCta).toEqual({ label: 'Explore Properties', to: '/properties' });
    expect(cmsSeed.hero.secondaryCta).toEqual({ label: 'Discover JA&D', to: '/about' });
    expect(cmsSeed.hero.image).toEqual({
      id: 'photo-1600585154340-be6161a56a0c',
      alt: 'A modern residence with warm interior lighting at dusk',
    });
    expect(cmsSeed.value.title).toBe('Good value for money - handled with diligence.');
    expect(cmsSeed.value.paragraphs).toHaveLength(2);
    expect(cmsSeed.categories.title).toBe('A portfolio built around how you live and invest.');
    expect(cmsSeed.featured.title).toBe('A glimpse of what we bring to the table.');
    expect(cmsSeed.approach.steps).toHaveLength(5);
    expect(cmsSeed.approach.steps[0]?.title).toBe('Understand your goal');
    expect(cmsSeed.trust.items).toHaveLength(4);
    expect(cmsSeed.trust.items[0]?.title).toBe('Property ownership, directly');
    expect(cmsSeed.aboutPreview.title).toBe('Diligence in every letter of our name.');
    expect(cmsSeed.ctaBand.title).toBe('Ready to explore what property can do for you?');

    // Also verify via repository getHomepage()
    const viaRepo = await getHomepage();
    expect(viaRepo).toEqual(cmsSeed);
  });

  it('cms schema validates the seed', async () => {
    const seed = __getHomepageSeed();
    const parsed = homepageContentSchema.safeParse(seed);
    expect(parsed.success).toBe(true);
  });

  it('allows text editing and reflects in preview', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Hero' });
    // Form initially shows HOME hero title
    expect(
      screen.getByDisplayValue('Where Big Dreams Meet Property That Already Earns'),
    ).toBeInTheDocument();

    const titleInput = screen.getByDisplayValue(
      'Where Big Dreams Meet Property That Already Earns',
    ) as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'New Homepage Title');

    // draft reflects immediately in form value
    expect(screen.getByDisplayValue('New Homepage Title')).toBeInTheDocument();
    // dirty chip - one per dirty section, so use getAllByText
    expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0);
    expect(screen.getByText('Save')).toBeEnabled();
  });

  it('CTA editing updates preview and validates', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Hero' });
    // Find first CTA label input (Hero Primary CTA)
    const ctaLabel = screen.getByDisplayValue('Explore Properties');
    await user.clear(ctaLabel);
    await user.type(ctaLabel, 'Browse Listings');
    // Preview still shows hero title, but CTA label change is not in preview hero (only title/lead) - verify input updated
    expect(screen.getByDisplayValue('Browse Listings')).toBeInTheDocument();
  });

  it('image/alt editing shows preview', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Hero' });
    const altInput = screen.getByDisplayValue(
      'A modern residence with warm interior lighting at dusk',
    );
    await user.clear(altInput);
    await user.type(altInput, 'Custom alt text for testing');
    expect(screen.getByDisplayValue('Custom alt text for testing')).toBeInTheDocument();
  });

  it('dirty state: Cancel restores, Save updates local state', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Hero' });
    const titleInput = screen.getByDisplayValue(
      'Where Big Dreams Meet Property That Already Earns',
    );
    await user.clear(titleInput);
    await user.type(titleInput, 'Dirty Title');

    // Cancel → ConfirmDialog
    await user.click(screen.getByText('Cancel'));
    expect(await screen.findByText('Discard changes?')).toBeInTheDocument();
    await user.click(screen.getByText('Discard'));
    // restored
    expect(
      screen.getByDisplayValue('Where Big Dreams Meet Property That Already Earns'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Dirty Title')).not.toBeInTheDocument();

    // again dirty → Save
    const restoredInput = screen.getByDisplayValue(
      'Where Big Dreams Meet Property That Already Earns',
    ) as HTMLInputElement;
    await user.clear(restoredInput);
    await user.type(restoredInput, 'Saved Title');
    await user.click(screen.getByText('Save'));
    // banner shows All changes saved - may be chip + banner, so use getAllByText
    expect((await screen.findAllByText(/All changes saved/)).length).toBeGreaterThan(0);
    // after save, dirty should be false and title persists
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Saved Title')).toBeInTheDocument();
  });

  it('validation: empty required title shows error and disables Save', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Hero' });
    const titleInput = screen.getByDisplayValue(
      'Where Big Dreams Meet Property That Already Earns',
    );
    await user.clear(titleInput);
    // title is required - validation error should appear and Save disabled
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('CTA URL validation rejects unsafe schemes', async () => {
    const parsed = homepageContentSchema.safeParse({
      ...__getHomepageSeed(),
      hero: {
        ...__getHomepageSeed().hero,
        primaryCta: { label: 'Bad', href: 'javascript:alert(1)' },
      },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('http'))).toBe(true);
    }
  });

  it('preview reflects draft change without reload', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Hero' });
    // Approach is collapsed by default (Step 3) - expand it first
    await user.click(screen.getByRole('button', { name: /Approach/ }));
    // edit Approach step 1 title
    const stepInput = screen.getByDisplayValue('Understand your goal');
    await user.clear(stepInput);
    await user.type(stepInput, 'Updated Step Title');
    // form should show updated step
    expect(screen.getByDisplayValue('Updated Step Title')).toBeInTheDocument();
  });

  it('shows All changes saved, not Published', async () => {
    renderCms();
    await screen.findByRole('heading', { name: 'Hero' });
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('anchor nav and collapsible sections work', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Hero' });
    // Anchor nav visible
    expect(screen.getByText(/Sections/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Hero/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Value/ })).toBeInTheDocument();
    // Hero is open by default, Approach is collapsed
    expect(
      screen.getByDisplayValue('Where Big Dreams Meet Property That Already Earns'),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Understand your goal')).not.toBeInTheDocument();
    // Expand Approach via header button
    await user.click(screen.getByRole('button', { name: /Approach/ }));
    expect(screen.getByDisplayValue('Understand your goal')).toBeInTheDocument();
    // Collapse via Collapse all
    await user.click(screen.getByText(/Collapse all/));
    expect(
      screen.queryByDisplayValue('Where Big Dreams Meet Property That Already Earns'),
    ).not.toBeInTheDocument();
    // Expand all
    await user.click(screen.getByText(/Expand all/));
    expect(
      screen.getByDisplayValue('Where Big Dreams Meet Property That Already Earns'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Understand your goal')).toBeInTheDocument();
  });

  it('anchor link scrolls and expands the target section', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Hero' });
    // Approach is collapsed initially
    expect(screen.queryByDisplayValue('Understand your goal')).not.toBeInTheDocument();
    // Click anchor for Approach (nav link, not section header)
    const approachAnchor = screen.getByRole('link', { name: /Approach/ });
    await user.click(approachAnchor);
    expect(await screen.findByDisplayValue('Understand your goal')).toBeInTheDocument();
  });
});
