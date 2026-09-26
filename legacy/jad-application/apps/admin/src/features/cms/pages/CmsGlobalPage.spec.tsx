import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MOCK_MEMBER, MOCK_SUPER_ADMIN } from '@jad/mock';
import { globalContentSchema } from '@jad/contracts';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { CmsGlobalPage } from './CmsGlobalPage';
import { __getGlobalSeed, __resetGlobalForTests, getGlobal } from '../services/cmsRepository';

function renderCms(route = '/admin/cms/global', user = MOCK_SUPER_ADMIN) {
  return renderWithProviders(<CmsGlobalPage />, { route, user });
}

describe('CmsGlobalPage - Global Content CMS', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    __resetGlobalForTests();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
    vi.restoreAllMocks();
  });

  it('SUPER_ADMIN can access Global Content CMS', async () => {
    renderCms('/admin/cms/global', MOCK_SUPER_ADMIN);
    expect(await screen.findByText('Global Content CMS')).toBeInTheDocument();
    expect(
      screen.getByText(/Manage site-wide brand, logo, footer, Messenger, and SEO/),
    ).toBeInTheDocument();
  });

  it('MEMBER cannot access Global Content CMS (Forbidden)', async () => {
    const { RequireRole } = await import('../../../app/RequireRole');
    const { MemoryRouter, Route, Routes } = await import('react-router');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    render(
      <SessionProvider initialUser={MOCK_MEMBER as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/global']}>
            <Routes>
              <Route
                path="/admin/cms/global"
                element={
                  <RequireRole>
                    <CmsGlobalPage />
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

  it('unauthenticated user is redirected away from Global Content CMS', async () => {
    const { RequireRole } = await import('../../../app/RequireRole');
    const { MemoryRouter, Route, Routes } = await import('react-router');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    render(
      <SessionProvider initialUser={null as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/global']}>
            <Routes>
              <Route
                path="/admin/cms/global"
                element={
                  <RequireRole>
                    <CmsGlobalPage />
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
    expect(screen.queryByText('Global Content CMS')).not.toBeInTheDocument();
  });

  it('Website CMS navigation entry is visible to SUPER_ADMIN for Global (no Coming soon)', async () => {
    const { ADMIN_NAV_ITEMS, canAccess } = await import('../../../app/navigation');
    const cmsItem = ADMIN_NAV_ITEMS.find((i) => i.to === '/admin/cms');
    expect(cmsItem).toBeDefined();
    expect(canAccess(MOCK_SUPER_ADMIN.role as never, cmsItem!)).toBe(true);
    expect(cmsItem?.dropdown?.some((d) => !('divider' in d) && d.to === '/admin/cms/global')).toBe(
      true,
    );
    expect(
      cmsItem?.dropdown?.some(
        (d) => !('divider' in d) && d.to === '/admin/cms/global' && d.label === 'Global Content',
      ),
    ).toBe(true);
    expect(
      cmsItem?.dropdown?.some(
        (d) => !('divider' in d) && d.label.includes('Coming soon') && d.to === '/admin/cms/global',
      ),
    ).toBe(false);
  });

  it('renders all six Global sections (navigation is not CMS-editable)', async () => {
    renderCms();
    expect(await screen.findByRole('heading', { name: 'Brand' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Site Logo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Auth Brand Mark' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Navigation' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Footer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Messenger FAB' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'SEO' })).toBeInTheDocument();
  });

  it('initial CMS values mirror the site-wide SSOTs', async () => {
    const seed = __getGlobalSeed();
    expect(seed.brand.name).toBe('JA&D Realty Services');
    expect(seed.brand.shortName).toBe('JA&D');
    expect(seed.brand.positioningLine).toBe('Where Big Dreams Meet Property That Already Earns');
    expect(seed.logo).toEqual({ id: '/ja-d-logo.png', alt: 'JA&D Realty Services' });
    expect(seed.brandMark).toEqual({
      id: '/ja-d-auth-logo.png',
      alt: 'JA&D Realty Services (white)',
    });
    expect(seed.browserIcon).toEqual({
      id: '/ja-d-favicon.png',
      alt: 'JA&D Realty Services favicon',
    });
    expect(seed.nav).toHaveLength(5);
    expect(seed.nav[0]).toMatchObject({ label: 'Home', to: '/' });
    expect(seed.authNav).toHaveLength(2);
    expect(seed.authNav[0]).toMatchObject({ label: 'Login', to: '/login' });
    expect(seed.footer.contactHeading).toBe('Reach us directly');
    expect(seed.footer.contacts).toHaveLength(3);
    expect(seed.footer.contacts[1]).toMatchObject({
      label: 'Email',
      value: 'info.jaandd@gmail.com',
    });
    expect(seed.messenger).toMatchObject({
      url: 'https://m.me/JADRealtyServices',
      label: "Let's Talk",
      hideOnAuth: true,
    });
    expect(seed.seo.theme).toEqual({
      primary: '#2c6aa7',
      secondary: '#3477b8',
      accent: '#a9853a',
      accentLight: '#dac56a',
      brandDeep: '#142b47',
    });
    const viaRepo = await getGlobal();
    expect(viaRepo).toEqual(globalContentSchema.parse(seed));
  });

  it('cms schema validates the seed', async () => {
    const seed = __getGlobalSeed();
    const parsed = globalContentSchema.safeParse(seed);
    expect(parsed.success).toBe(true);
  });

  it('allows editing the brand name', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Brand' });
    const input = screen.getByDisplayValue('JA&D Realty Services') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'JA&D Edited');
    await user.click(screen.getByText('Cancel'));
    expect(await screen.findByText('Discard changes?')).toBeInTheDocument();
    await user.click(screen.getByText('Discard'));
    expect(screen.getByDisplayValue('JA&D Realty Services')).toBeInTheDocument();
  });

  it('validation: empty brand name shows error and disables Save', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Brand' });
    const input = screen.getByDisplayValue('JA&D Realty Services') as HTMLInputElement;
    await user.clear(input);
    await waitFor(() => expect(screen.getByText('Save')).toBeDisabled());
  });

  it('navigation is not rendered in the CMS (managed in code)', async () => {
    renderCms();
    await screen.findByRole('heading', { name: 'Brand' });
    // The site navigation is not CMS-editable; no Navigation section/card exists.
    expect(screen.queryByRole('button', { name: /Navigation/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Add nav item')).not.toBeInTheDocument();
    expect(screen.queryByText('Add auth link')).not.toBeInTheDocument();
  });

  it('footer contact rows are editable and reorderable', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Brand' });
    await user.click(screen.getByRole('button', { name: /Footer/ }));

    expect(screen.getByText('info.jaandd@gmail.com')).toBeInTheDocument();

    await user.click(screen.getByText('Add contact row'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('New value')).toBeInTheDocument();
    await user.click(within(dialog).getByText('Save & close'));
    expect(screen.getByText('New value')).toBeInTheDocument();
  });

  it('messenger url validation rejects unsafe schemes', async () => {
    const seed = __getGlobalSeed();
    const parsed = globalContentSchema.safeParse({
      ...seed,
      messenger: { ...seed.messenger, url: 'javascript:alert(1)' },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('https'))).toBe(true);
    }
  });

  it('theme palette renders all five color fields and validates primary hex', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Brand' });
    await user.click(screen.getByRole('button', { name: /SEO/ }));

    expect(screen.getByDisplayValue('#2c6aa7')).toBeInTheDocument();
    expect(screen.getByDisplayValue('#3477b8')).toBeInTheDocument();
    expect(screen.getByDisplayValue('#a9853a')).toBeInTheDocument();
    expect(screen.getByDisplayValue('#dac56a')).toBeInTheDocument();
    expect(screen.getByDisplayValue('#142b47')).toBeInTheDocument();

    const primary = screen.getByDisplayValue('#2c6aa7') as HTMLInputElement;
    await user.clear(primary);
    await user.type(primary, 'blue');
    await waitFor(() =>
      expect(screen.getByText(/Colors must be a #RRGGBB hex value/)).toBeInTheDocument(),
    );
  });

  it('anchor nav and collapsible sections work', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Brand' });
    expect(screen.getByText(/Sections \(6\)/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Brand/ }).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('link', { name: /Navigation/ })).not.toBeInTheDocument();

    expect(screen.queryByText('/properties')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Footer/ }));
    expect(screen.getByText('info.jaandd@gmail.com')).toBeInTheDocument();

    await user.click(screen.getByText(/Collapse all/));
    expect(screen.queryByText('info.jaandd@gmail.com')).not.toBeInTheDocument();

    await user.click(screen.getByText(/Expand all/));
    expect(screen.getByText('info.jaandd@gmail.com')).toBeInTheDocument();
  });

  it('shows All changes saved, not Published', async () => {
    renderCms();
    await screen.findByRole('heading', { name: 'Brand' });
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
  });
});
