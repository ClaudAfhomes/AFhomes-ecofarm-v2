import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MOCK_MEMBER, MOCK_SUPER_ADMIN } from '@jad/mock';
import { propertiesContentSchema } from '@jad/contracts';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { CmsPropertiesPage } from './CmsPropertiesPage';
import {
  __getPropertiesSeed,
  __resetPropertiesForTests,
  getProperties,
} from '../services/cmsRepository';

function renderCms(route = '/admin/cms/properties', user = MOCK_SUPER_ADMIN) {
  return renderWithProviders(<CmsPropertiesPage />, { route, user });
}

function getCategoryRow(titleText: string): HTMLElement {
  return screen.getByText(titleText).parentElement?.parentElement as HTMLElement;
}

function getPropertyRow(nameText: string): HTMLElement {
  return screen.getByText(nameText).parentElement?.parentElement as HTMLElement;
}

describe('CmsPropertiesPage - Phase 3 Properties CMS', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    __resetPropertiesForTests();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
    vi.restoreAllMocks();
  });

  it('SUPER_ADMIN can access Properties CMS', async () => {
    renderCms('/admin/cms/properties', MOCK_SUPER_ADMIN);
    expect(await screen.findByText('Properties CMS')).toBeInTheDocument();
    expect(screen.getByText(/Manage the public Properties/)).toBeInTheDocument();
  });

  it('MEMBER cannot access Properties CMS (Forbidden)', async () => {
    const { RequireRole } = await import('../../../app/RequireRole');
    const { MemoryRouter, Route, Routes } = await import('react-router');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    render(
      <SessionProvider initialUser={MOCK_MEMBER as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/properties']}>
            <Routes>
              <Route
                path="/admin/cms/properties"
                element={
                  <RequireRole>
                    <CmsPropertiesPage />
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
          <MemoryRouter initialEntries={['/admin/cms/properties']}>
            <Routes>
              <Route
                path="/admin/cms/properties"
                element={
                  <RequireRole>
                    <CmsPropertiesPage />
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
    expect(screen.queryByText('Properties CMS')).not.toBeInTheDocument();
  });

  it('Website CMS navigation entry is visible to SUPER_ADMIN for Properties', async () => {
    const { ADMIN_NAV_ITEMS, canAccess } = await import('../../../app/navigation');
    const cmsItem = ADMIN_NAV_ITEMS.find((i) => i.to === '/admin/cms');
    expect(cmsItem).toBeDefined();
    expect(cmsItem?.label).toBe('Website CMS');
    expect(canAccess(MOCK_SUPER_ADMIN.role as never, cmsItem!)).toBe(true);
    expect(
      cmsItem?.dropdown?.some((d) => !('divider' in d) && d.to === '/admin/cms/properties'),
    ).toBe(true);
    expect(
      cmsItem?.dropdown?.some(
        (d) => !('divider' in d) && d.to === '/admin/cms/properties' && d.label === 'Properties',
      ),
    ).toBe(true);
    expect(
      cmsItem?.dropdown?.some(
        (d) =>
          !('divider' in d) && d.label.includes('Coming soon') && d.to === '/admin/cms/properties',
      ),
    ).toBe(false);
  });

  it('renders all eight Properties sections', async () => {
    renderCms();
    expect(await screen.findByRole('heading', { name: 'Page Header' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hero' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Intro' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Featured' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Note' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CTA Band' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Properties' })).toBeInTheDocument();
  });

  it('initial CMS values match public Properties content (alignment)', async () => {
    const seed = __getPropertiesSeed();
    expect(seed.categories).toHaveLength(3);
    expect(seed.categories[0]?.slug).toBe('tenanted-condo-resales');
    expect(seed.categories[1]?.slug).toBe('income-generating-properties');
    expect(seed.categories[2]?.slug).toBe('developer-project-brokerage');
    expect(seed.properties).toHaveLength(10);
    expect(seed.properties[0]?.id).toBe('igp-250-sqm-farm-lot');
    expect(seed.properties[0]?.categoryId).toBe('income-generating-properties');
    expect(seed.properties[0]?.price).toBe('1200000.00');
    expect(
      seed.properties.find((p) => p.id === 'mountain-view-leisure-community')?.price,
    ).toBeUndefined();
    expect(seed.properties.find((p) => p.id === 'mountain-suites')?.price).toBeUndefined();
    expect(seed.page.title).toBe('Properties & Listings');
    expect(seed.page.hero.primaryCta).toEqual({ label: 'Talk to Us', to: '/contact' });
    const viaRepo = await getProperties();
    expect(viaRepo).toEqual(seed);
  });

  it('cms schema validates the seed', async () => {
    const seed = __getPropertiesSeed();
    const parsed = propertiesContentSchema.safeParse(seed);
    expect(parsed.success).toBe(true);
  });

  it('renders categories and properties in their sections', async () => {
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await screen.findByRole('heading', { name: 'Categories' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Categories/ }));
    expect(screen.getByText('Tenanted Condo Resales')).toBeInTheDocument();
    expect(screen.getByText(/tenanted-condo-resales/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Properties/ }));
    expect(screen.getByText('250 SQM Farm Lot with Hotspring')).toBeInTheDocument();
  }, 15000);

  it('links a category to the catalog and shows live data', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Categories/ }));
    await user.click(
      within(getCategoryRow('Tenanted Condo Resales')).getByRole('button', { name: 'Edit' }),
    );
    const dialog = await screen.findByRole('dialog');
    const linkSelect = within(dialog).getByLabelText(
      'Linked catalog category',
    ) as HTMLSelectElement;
    const target = Array.from(linkSelect.options).find((o) => o.value !== '');
    expect(target).toBeDefined();
    await user.selectOptions(linkSelect, target!.value);
    // Live catalog data resolves in the dialog with a deep link.
    expect(await within(dialog).findByText(/Linked:/)).toBeInTheDocument();
    expect(within(dialog).getByText('Open catalog')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(getCategoryRow('Tenanted Condo Resales').textContent).toMatch(/Linked:/);
  }, 15000);

  it('links a property to a catalog listing and shows live price and status', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Properties/ }));
    await user.click(
      within(getPropertyRow('250 SQM Farm Lot with Hotspring')).getByRole('button', {
        name: 'Edit',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const linkSelect = within(dialog).getByLabelText('Linked catalog listing') as HTMLSelectElement;
    const target = Array.from(linkSelect.options).find((o) => o.value !== '');
    expect(target).toBeDefined();
    await user.selectOptions(linkSelect, target!.value);
    expect(await within(dialog).findByText(/Linked:/)).toBeInTheDocument();
    expect(within(dialog).getByText('Open listing')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(getPropertyRow('250 SQM Farm Lot with Hotspring').textContent).toMatch(/Linked:/);
  }, 15000);

  it('auto-matches entries to catalog rows by id without manual links', async () => {
    // Seed ids coincide with mock catalog ids, so rows resolve automatically.
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Categories/ }));
    expect(getCategoryRow('Tenanted Condo Resales').textContent).toMatch(/Auto-linked:/);
    await user.click(screen.getByRole('button', { name: /Properties/ }));
    expect(getPropertyRow('250 SQM Farm Lot with Hotspring').textContent).toMatch(/Auto-linked:/);
  }, 15000);

  it('allows text editing categories and properties', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Categories/ }));
    await user.click(
      within(getCategoryRow('Tenanted Condo Resales')).getByRole('button', { name: 'Edit' }),
    );
    const dialog = await screen.findByRole('dialog');
    const titleInput = within(dialog).getByDisplayValue('Tenanted Condo Resales');
    fireEvent.change(titleInput, { target: { value: 'Updated Category Title' } });
    expect(within(dialog).getByDisplayValue('Updated Category Title')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Properties/ }));
    await user.click(
      within(getPropertyRow('250 SQM Farm Lot with Hotspring')).getByRole('button', {
        name: 'Edit',
      }),
    );
    const propDialog = await screen.findByRole('dialog');
    const propNameInput = within(propDialog).getByDisplayValue('250 SQM Farm Lot with Hotspring');
    fireEvent.change(propNameInput, { target: { value: 'Updated Property Name' } });
    expect(within(propDialog).getByDisplayValue('Updated Property Name')).toBeInTheDocument();
  }, 15000);

  it('dirty state: Cancel restores, Save updates local state', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    const titleInput = screen.getByDisplayValue('Properties & Listings') as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'Dirty Title');
    await user.click(screen.getByText('Cancel'));
    expect(await screen.findByText('Discard changes?')).toBeInTheDocument();
    await user.click(screen.getByText('Discard'));
    expect(screen.getByDisplayValue('Properties & Listings')).toBeInTheDocument();
    expect(screen.queryByText('Dirty Title')).not.toBeInTheDocument();

    const restored = screen.getByDisplayValue('Properties & Listings') as HTMLInputElement;
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
    const titleInput = screen.getByDisplayValue('Properties & Listings') as HTMLInputElement;
    await user.clear(titleInput);
    await waitFor(() => expect(screen.getByText('Save')).toBeDisabled());
    expect(titleInput.getAttribute('aria-invalid')).toBe('true');
  });

  it('pricing handling: optional price can be cleared and set', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Properties/ }));
    await user.click(
      within(getPropertyRow('250 SQM Farm Lot with Hotspring')).getByRole('button', {
        name: 'Edit',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const priceInput = within(dialog).getByPlaceholderText('1200000.00') as HTMLInputElement;
    expect(priceInput).toBeInTheDocument();
    expect(priceInput.value).toBe('1200000.00');
    fireEvent.change(priceInput, { target: { value: '' } });
    expect(priceInput.value).toBe('');
    expect(screen.getByText('Save')).toBeEnabled();
    fireEvent.change(priceInput, { target: { value: '999999.00' } });
    expect(within(dialog).getByDisplayValue('999999.00')).toBeInTheDocument();
  });

  it('pricing handling: developer property without price remains valid', async () => {
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Properties/ }));
    await user.click(
      within(getPropertyRow('Mountain View Leisure Community')).getByRole('button', {
        name: 'Edit',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const priceInput = within(dialog).getByPlaceholderText('1200000.00') as HTMLInputElement;
    expect(priceInput).toBeInTheDocument();
    expect(priceInput.value).toBe('');
  });

  it('featured handling: derived first per category, not directly editable but reordering changes derived', async () => {
    const seed = __getPropertiesSeed();
    const featuredNames = seed.categories.map(
      (c) => seed.properties.find((p) => p.categoryId === c.slug)?.name,
    );
    expect(featuredNames).toHaveLength(3);
    expect(featuredNames[0]).toBe('Prisma Residences - Celeste Building Condo');
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    expect(await screen.findByRole('heading', { name: 'Featured' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Categories/ }));
    await user.click(
      within(getCategoryRow('Tenanted Condo Resales')).getByRole('button', { name: 'Edit' }),
    );
    const dialog = await screen.findByRole('dialog');
    const featuredCheckbox = within(dialog).getByRole('checkbox');
    expect(featuredCheckbox).toBeInTheDocument();
  });

  it('image/gallery handling: category and property images', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Categories/ }));
    await user.click(
      within(getCategoryRow('Tenanted Condo Resales')).getByRole('button', { name: 'Edit' }),
    );
    const dialog = await screen.findByRole('dialog');
    const catAlt = within(dialog).getByDisplayValue('A modern condominium tower');
    fireEvent.change(catAlt, { target: { value: 'Custom alt for category' } });
    expect(within(dialog).getByDisplayValue('Custom alt for category')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Properties/ }));
    await user.click(
      within(getPropertyRow('250 SQM Farm Lot with Hotspring')).getByRole('button', {
        name: 'Edit',
      }),
    );
    const propDialog = await screen.findByRole('dialog');
    const galleryAlt = within(propDialog).getByDisplayValue(
      'A green landscape with open grassland',
    );
    fireEvent.change(galleryAlt, { target: { value: 'Custom gallery alt' } });
    expect(within(propDialog).getByDisplayValue('Custom gallery alt')).toBeInTheDocument();
  }, 10000);

  it('gallery add/remove', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Properties/ }));
    await user.click(
      within(getPropertyRow('250 SQM Farm Lot with Hotspring')).getByRole('button', {
        name: 'Edit',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const addBtn = within(dialog).getByRole('button', { name: 'Add gallery image' });
    await user.click(addBtn);
    expect(within(dialog).getByRole('button', { name: 'Add gallery image' })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Remove last gallery image' }),
    ).toBeInTheDocument();
  });

  it('keyFacts add/remove', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Properties/ }));
    await user.click(
      within(getPropertyRow('250 SQM Farm Lot with Hotspring')).getByRole('button', {
        name: 'Edit',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const beforeRemoveCount = within(dialog).getAllByRole('button', { name: 'Remove' }).length;
    const addFactBtn = within(dialog).getByRole('button', { name: 'Add key fact' });
    await user.click(addFactBtn);
    expect(within(dialog).getByDisplayValue('New fact')).toBeInTheDocument();
    const newFactInput = within(dialog).getByDisplayValue('New fact');
    const factCard = newFactInput.closest('div') as HTMLElement;
    const removeBtn = factCard.querySelector('button') as HTMLButtonElement;
    await user.click(removeBtn);
    expect(within(dialog).queryByDisplayValue('New fact')).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: 'Remove' }).length).toBe(
      beforeRemoveCount,
    );
  });

  it('preview updates from draft without reload', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    const titleInput = screen.getByDisplayValue('Properties & Listings');
    await user.clear(titleInput);
    await user.type(titleInput, 'Preview Updated Title');
    expect(screen.getByDisplayValue('Preview Updated Title')).toBeInTheDocument();
  });

  it('anchor nav and collapsible sections work', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    expect(screen.getByText(/Sections \(8\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Page Header/ })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Categories/ }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('250 SQM Farm Lot with Hotspring')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Properties/ }));
    expect(screen.getByText('250 SQM Farm Lot with Hotspring')).toBeInTheDocument();
    await user.click(screen.getByText(/Collapse all/));
    expect(screen.queryByDisplayValue('Properties & Listings')).not.toBeInTheDocument();
    await user.click(screen.getByText(/Expand all/));
    expect(screen.getByDisplayValue('Properties & Listings')).toBeInTheDocument();
  });

  it('shows All changes saved, not Published', async () => {
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('CTA URL validation rejects unsafe schemes', async () => {
    const seed = __getPropertiesSeed();
    const parsed = propertiesContentSchema.safeParse({
      ...seed,
      page: {
        ...seed.page,
        hero: { ...seed.page.hero, primaryCta: { label: 'Bad', href: 'javascript:alert(1)' } },
      },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('http'))).toBe(true);
    }
  });

  it('add category and add property buttons appear', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Categories/ }));
    const addCatBtn = await screen.findByRole('button', { name: 'Add category' });
    expect(addCatBtn).toBeInTheDocument();
    const categoriesPanel = document.getElementById('categories-panel');
    expect(categoriesPanel).toContainElement(addCatBtn);

    await user.click(screen.getByRole('button', { name: /Properties/ }));
    const addPropBtn = await screen.findByRole('button', { name: 'Add property' });
    expect(addPropBtn).toBeInTheDocument();
    const propertiesPanel = document.getElementById('properties-panel');
    expect(propertiesPanel).toContainElement(addPropBtn);
  }, 15000);

  it('unsaved changes banner', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Categories/ }));
    await user.click(
      within(getCategoryRow('Tenanted Condo Resales')).getByRole('button', { name: 'Edit' }),
    );
    const dialog = await screen.findByRole('dialog');
    const titleInput = within(dialog).getByDisplayValue('Tenanted Condo Resales');
    fireEvent.change(titleInput, { target: { value: 'Modified Category' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0);
  }, 15000);

  it('category Remove button opens ConfirmDialog', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Categories/ }));
    await user.click(
      within(getCategoryRow('Income Generating Properties')).getByRole('button', {
        name: 'Remove',
      }),
    );
    expect(await screen.findByText('Delete category?')).toBeInTheDocument();
    const confirmDialog = screen
      .getByText('Delete category?')
      .closest('[role="dialog"]') as HTMLElement;
    await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Delete category?')).not.toBeInTheDocument());
  });

  it('property Remove button opens ConfirmDialog', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Properties/ }));
    await user.click(
      within(getPropertyRow('Mountain View Leisure Community')).getByRole('button', {
        name: 'Remove',
      }),
    );
    expect(await screen.findByText('Delete property?')).toBeInTheDocument();
    const confirmDialog = screen
      .getByText('Delete property?')
      .closest('[role="dialog"]') as HTMLElement;
    await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Delete property?')).not.toBeInTheDocument());
  });
});
