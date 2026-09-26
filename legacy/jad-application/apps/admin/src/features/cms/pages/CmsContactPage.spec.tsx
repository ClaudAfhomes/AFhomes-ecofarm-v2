import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MOCK_MEMBER, MOCK_SUPER_ADMIN } from '@jad/mock';
import { contactContentSchema } from '@jad/contracts';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { CmsContactPage } from './CmsContactPage';
import { __getContactSeed, __resetContactForTests, getContact } from '../services/cmsRepository';

function renderCms(route = '/admin/cms/contact', user = MOCK_SUPER_ADMIN) {
  return renderWithProviders(<CmsContactPage />, { route, user });
}

describe('CmsContactPage - Phase 8 Contact CMS', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    __resetContactForTests();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
    vi.restoreAllMocks();
  });

  it('SUPER_ADMIN can access Contact CMS', async () => {
    renderCms('/admin/cms/contact', MOCK_SUPER_ADMIN);
    expect(await screen.findByText('Contact CMS')).toBeInTheDocument();
    expect(screen.getByText(/Manage the public Contact/)).toBeInTheDocument();
  });

  it('MEMBER cannot access Contact CMS (Forbidden)', async () => {
    const { RequireRole } = await import('../../../app/RequireRole');
    const { MemoryRouter, Route, Routes } = await import('react-router');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    render(
      <SessionProvider initialUser={MOCK_MEMBER as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/contact']}>
            <Routes>
              <Route
                path="/admin/cms/contact"
                element={
                  <RequireRole>
                    <CmsContactPage />
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
          <MemoryRouter initialEntries={['/admin/cms/contact']}>
            <Routes>
              <Route
                path="/admin/cms/contact"
                element={
                  <RequireRole>
                    <CmsContactPage />
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
    expect(screen.queryByText('Contact CMS')).not.toBeInTheDocument();
  });

  it('Website CMS navigation entry is visible to SUPER_ADMIN for Contact (no Coming soon)', async () => {
    const { ADMIN_NAV_ITEMS, canAccess } = await import('../../../app/navigation');
    const cmsItem = ADMIN_NAV_ITEMS.find((i) => i.to === '/admin/cms');
    expect(cmsItem).toBeDefined();
    expect(cmsItem?.label).toBe('Website CMS');
    expect(canAccess(MOCK_SUPER_ADMIN.role as never, cmsItem!)).toBe(true);
    expect(cmsItem?.dropdown?.some((d) => !('divider' in d) && d.to === '/admin/cms/contact')).toBe(
      true,
    );
    expect(
      cmsItem?.dropdown?.some(
        (d) => !('divider' in d) && d.to === '/admin/cms/contact' && d.label === 'Contact',
      ),
    ).toBe(true);
    expect(
      cmsItem?.dropdown?.some(
        (d) =>
          !('divider' in d) && d.label.includes('Coming soon') && d.to === '/admin/cms/contact',
      ),
    ).toBe(false);
  });

  it('renders all six Contact sections', async () => {
    renderCms();
    expect(await screen.findByRole('heading', { name: 'Page Header' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hero' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contact Methods' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Message Form' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CTA Band' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Footer Details' })).toBeInTheDocument();
  });

  it('initial CMS values match public CONTACT content (alignment)', async () => {
    const seed = __getContactSeed();
    expect(seed.title).toBe('Talk with JA&D Realty Services');
    expect(seed.hero.eyebrow).toBe('Contact');
    expect(seed.hero.primaryCta).toEqual({ label: 'Explore Properties', to: '/properties' });
    expect(seed.methods).toHaveLength(4);
    expect(seed.methods[0]).toMatchObject({
      label: 'Messenger',
      value: 'Message Us on Messenger',
      icon: 'messenger',
      href: 'https://m.me/JADRealtyServices',
      external: true,
      featured: true,
    });
    expect(seed.methods[1]).toMatchObject({
      label: 'Phone',
      value: '0965-250-0052',
      icon: 'phone',
      href: 'tel:+639652500052',
    });
    expect(seed.form.heading).toBe('Send us a message');
    expect(seed.cta.title).toBe('Prefer to explore on your own first?');
    expect(seed.cta.secondaryCta).toEqual({ label: 'Read the FAQs', to: '/faqs' });
    expect(seed.detailsHeading).toBe('Reach us directly');
    expect(seed.details).toHaveLength(3);
    expect(seed.details[1]).toMatchObject({ label: 'Email', value: 'info.jaandd@gmail.com' });
    const viaRepo = await getContact();
    expect(viaRepo).toEqual(contactContentSchema.parse(seed));
  });

  it('cms schema validates the seed', async () => {
    const seed = __getContactSeed();
    const parsed = contactContentSchema.safeParse(seed);
    expect(parsed.success).toBe(true);
  });

  it('renders contact methods in their section', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Contact Methods/ }));
    expect(screen.getByText('Message Us on Messenger')).toBeInTheDocument();
    expect(screen.getByText('0965-250-0052')).toBeInTheDocument();
    expect(screen.getByText('info.jaandd@gmail.com')).toBeInTheDocument();
  });

  it('allows editing a contact method', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Contact Methods/ }));

    const editBtns = screen.getAllByText('Edit');
    await user.click(editBtns[0]!);

    const dialog = await screen.findByRole('dialog');
    const valueInput = within(dialog).getByDisplayValue('Message Us on Messenger');
    fireEvent.change(valueInput, { target: { value: 'Updated method value' } });

    await user.click(within(dialog).getByText('Save & close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByText('Updated method value')).toBeInTheDocument();
    expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0);
  });

  it('dirty state: Cancel restores, Save updates local state', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    const titleInput = screen.getByDisplayValue(
      'Talk with JA&D Realty Services',
    ) as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'Dirty Title');
    await user.click(screen.getByText('Cancel'));
    expect(await screen.findByText('Discard changes?')).toBeInTheDocument();
    await user.click(screen.getByText('Discard'));
    expect(screen.getByDisplayValue('Talk with JA&D Realty Services')).toBeInTheDocument();
    expect(screen.queryByText('Dirty Title')).not.toBeInTheDocument();

    const restored = screen.getByDisplayValue('Talk with JA&D Realty Services') as HTMLInputElement;
    await user.clear(restored);
    await user.type(restored, 'Saved Title');
    await user.click(screen.getByText('Save'));
    expect((await screen.findAllByText(/All changes saved/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Saved Title')).toBeInTheDocument();
  });

  it('validation: empty required title shows error and disables Save', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    const titleInput = screen.getByDisplayValue(
      'Talk with JA&D Realty Services',
    ) as HTMLInputElement;
    await user.clear(titleInput);
    await waitFor(() => expect(screen.getByText('Save')).toBeDisabled());
  });

  it('ordering: Move up/down reorders methods', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Contact Methods/ }));

    const PRECEDING = Node.DOCUMENT_POSITION_PRECEDING;
    const messenger = () => screen.getByText('Message Us on Messenger');
    const phone = () => screen.getByText('0965-250-0052');

    // Initial order: Messenger before Phone
    expect(phone().compareDocumentPosition(messenger()) & PRECEDING).toBeTruthy();

    // Move Messenger down
    const moveDownBtns = screen.getAllByText('↓');
    await user.click(moveDownBtns[0]!);

    // Now Phone before Messenger
    expect(messenger().compareDocumentPosition(phone()) & PRECEDING).toBeTruthy();

    // Move it back up
    const moveUpBtns = screen.getAllByText('↑');
    await user.click(moveUpBtns[1]!);
    expect(phone().compareDocumentPosition(messenger()) & PRECEDING).toBeTruthy();
  });

  it('add/remove contact methods', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Contact Methods/ }));

    await user.click(screen.getByText('Add contact method'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('New value')).toBeInTheDocument();
    await user.click(within(dialog).getByText('Save & close'));

    expect(screen.getByText('New value')).toBeInTheDocument();

    const removeBtns = screen.getAllByText('Remove');
    await user.click(removeBtns[4]!); // new method is the 5th method row
    const confirmDialog = await screen.findByRole('dialog', { name: 'Delete contact method?' });
    await user.click(within(confirmDialog).getByText('Delete'));

    expect(screen.queryByText('New value')).not.toBeInTheDocument();
  });

  it('footer details section is a read-only preview linked to Global Content', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Footer Details/ }));

    // Live preview of the global footer content (no edit controls)
    expect(screen.getByText('Reach us directly')).toBeInTheDocument();
    expect(screen.getByText('info.jaandd@gmail.com')).toBeInTheDocument();
    expect(screen.queryByText('Add contact detail')).not.toBeInTheDocument();

    const link = screen.getByRole('link', { name: /Global Content → Footer/ });
    expect(link).toHaveAttribute('href', '/admin/cms/global#footer');
  });

  it('anchor nav and collapsible sections work', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    expect(screen.getByText(/Sections \(6\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Page Header/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Contact Methods/ })).toBeInTheDocument();

    expect(screen.queryByText('Message Us on Messenger')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Contact Methods/ }));
    expect(screen.getByText('Message Us on Messenger')).toBeInTheDocument();

    await user.click(screen.getByText(/Collapse all/));
    expect(screen.queryByText('Message Us on Messenger')).not.toBeInTheDocument();

    await user.click(screen.getByText(/Expand all/));
    expect(screen.getByText('Message Us on Messenger')).toBeInTheDocument();
  });

  it('shows All changes saved, not Published', async () => {
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('contact method href validation rejects unsafe schemes', async () => {
    const seed = __getContactSeed();
    const parsed = contactContentSchema.safeParse({
      ...seed,
      methods: seed.methods.map((m, i) => (i === 0 ? { ...m, href: 'javascript:alert(1)' } : m)),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('Unsafe'))).toBe(true);
    }
  });
});
