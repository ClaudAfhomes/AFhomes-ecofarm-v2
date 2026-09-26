import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_ADMIN } from '@jad/mock';
import { CMS_PROPERTIES_SEED } from '@jad/contracts';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { CatalogPage } from './CatalogPage';

const { mockUsePropertiesCms } = vi.hoisted(() => ({ mockUsePropertiesCms: vi.fn() }));

vi.mock('../../cms/hooks/usePropertiesCms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cms/hooks/usePropertiesCms')>();
  return { ...actual, usePropertiesCms: (...args: unknown[]) => mockUsePropertiesCms(...args) };
});

describe('CatalogPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    server = installMockApi();
    server.install();
    // No CMS links by default (existing tests); link tests override per case.
    mockUsePropertiesCms.mockReturnValue({ data: undefined, isPending: false, isError: false });
  });

  afterEach(() => {
    server.restore();
  });

  it('renders page header with Properties title', async () => {
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Properties')).toBeInTheDocument();
    expect(screen.getByText(/Manage property listings/)).toBeInTheDocument();
  });

  it('shows Create Property button on listings tab', async () => {
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Create Property')).toBeInTheDocument();
  });

  it('renders entry cards for categories and listings', async () => {
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Property Categories')).toBeInTheDocument();
    expect(screen.getByText('Property Listings')).toBeInTheDocument();
  });

  it('defaults to listings tab with property data', async () => {
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('250 SQM Farm Lot with Hotspring')).toBeInTheDocument();
    expect(
      screen.getAllByText('Prisma Residences - Celeste Building Condo').length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Mountain View Leisure Community')).toBeInTheDocument();
  });

  it('shows category chips in listings table', async () => {
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('250 SQM Farm Lot with Hotspring');
    expect(screen.getAllByText('Income Generating Properties').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Tenanted Condo Resales').length).toBeGreaterThanOrEqual(1);
  });

  it('shows status chips in listings table', async () => {
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('250 SQM Farm Lot with Hotspring');
    expect(screen.getAllByText('ACTIVE').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('INACTIVE')).toBeInTheDocument();
  });

  it('shows Edit and Delete buttons in listings Actions column', async () => {
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('250 SQM Farm Lot with Hotspring');
    const editButtons = screen.getAllByText('Edit');
    expect(editButtons.length).toBeGreaterThanOrEqual(1);
    const deleteButtons = screen.getAllByText('Delete');
    expect(deleteButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders category and status filter selects', async () => {
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('250 SQM Farm Lot with Hotspring');
    expect(screen.getByLabelText('Filter by category')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();
  });

  it('filters by category when category select changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('250 SQM Farm Lot with Hotspring');

    const categorySelect = screen.getByLabelText('Filter by category');
    await user.selectOptions(categorySelect, 'tenanted-condo-resales');

    expect(screen.queryByText('250 SQM Farm Lot with Hotspring')).not.toBeInTheDocument();
    expect(
      screen.getAllByText('Prisma Residences - Celeste Building Condo').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('filters by status when status select changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('250 SQM Farm Lot with Hotspring');

    const statusSelect = screen.getByLabelText('Filter by status');
    await user.selectOptions(statusSelect, 'INACTIVE');

    expect(screen.queryByText('250 SQM Farm Lot with Hotspring')).not.toBeInTheDocument();
    expect(screen.getByText('INACTIVE')).toBeInTheDocument();
  });

  it('shows Clear button when a filter is active and resets filters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('250 SQM Farm Lot with Hotspring');

    expect(screen.queryByText('Clear')).not.toBeInTheDocument();

    const categorySelect = screen.getByLabelText('Filter by category');
    await user.selectOptions(categorySelect, 'tenanted-condo-resales');

    const clearBtn = screen.getByText('Clear');
    expect(clearBtn).toBeInTheDocument();

    await user.click(clearBtn);
    expect(screen.getByLabelText('Filter by category')).toHaveValue('ALL');
    expect(screen.getByLabelText('Filter by status')).toHaveValue('ALL');
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();
  });

  it('shows filtered-empty state when no properties match', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('250 SQM Farm Lot with Hotspring');

    const categorySelect = screen.getByLabelText('Filter by category');
    await user.selectOptions(categorySelect, 'income-generating-properties');

    const statusSelect = screen.getByLabelText('Filter by status');
    await user.selectOptions(statusSelect, 'INACTIVE');
    // income-generating-properties has only ACTIVE listings, so combo = 0
    expect(await screen.findByText('No properties match this filter')).toBeInTheDocument();
  });

  it('switches to categories tab and shows category data', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('Property Categories');

    await user.click(screen.getByText('Property Categories'));

    expect(await screen.findByText('Tenanted Condo Resales')).toBeInTheDocument();
    expect(screen.getByText('Income Generating Properties')).toBeInTheDocument();
    expect(screen.getByText('Developer Project Brokerage')).toBeInTheDocument();
  });

  it('shows Create Category button on categories tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('Property Categories');

    await user.click(screen.getByText('Property Categories'));

    expect(await screen.findByText('Create Category')).toBeInTheDocument();
  });

  it('shows category slug, featured, and listings count', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('Property Categories');

    await user.click(screen.getByText('Property Categories'));

    expect(await screen.findByText('tenanted-condo-resales')).toBeInTheDocument();
    expect(screen.getByText('income-generating-properties')).toBeInTheDocument();
    expect(screen.getAllByText('Featured').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Edit and Delete buttons in categories Actions column', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('Property Categories');

    await user.click(screen.getByText('Property Categories'));

    await screen.findByText('Tenanted Condo Resales');
    const editButtons = screen.getAllByText('Edit');
    expect(editButtons.length).toBeGreaterThanOrEqual(3);
    const deleteButtons = screen.getAllByText('Delete');
    expect(deleteButtons.length).toBeGreaterThanOrEqual(3);
  });

  it('shows In CMS links for listings referenced by CMS entries', async () => {
    const [firstProperty] = CMS_PROPERTIES_SEED.properties;
    mockUsePropertiesCms.mockReturnValue({
      data: {
        ...CMS_PROPERTIES_SEED,
        properties: [{ ...firstProperty!, catalogId: firstProperty!.id }],
      },
      isPending: false,
      isError: false,
    });
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText(firstProperty!.name);

    const links = screen.getAllByText('In CMS');
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]!.closest('a')).toHaveAttribute('href', '/admin/cms/properties#properties');
  });

  it('shows In CMS links for categories referenced by CMS entries', async () => {
    const user = userEvent.setup();
    const [firstCategory] = CMS_PROPERTIES_SEED.categories;
    mockUsePropertiesCms.mockReturnValue({
      data: {
        ...CMS_PROPERTIES_SEED,
        categories: [{ ...firstCategory!, catalogSlug: firstCategory!.slug }],
      },
      isPending: false,
      isError: false,
    });
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('Property Categories');

    await user.click(screen.getByText('Property Categories'));

    await screen.findByText(firstCategory!.title);
    const links = screen.getAllByText('In CMS');
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]!.closest('a')).toHaveAttribute('href', '/admin/cms/properties#categories');
  });

  it('auto-matches CMS entries to catalog rows by id without manual links', async () => {
    // Seed ids coincide with mock catalog ids - no explicit links needed.
    mockUsePropertiesCms.mockReturnValue({
      data: CMS_PROPERTIES_SEED,
      isPending: false,
      isError: false,
    });
    renderWithProviders(<CatalogPage />, { user: MOCK_ADMIN });
    await screen.findByText('250 SQM Farm Lot with Hotspring');

    const links = screen.getAllByText('In CMS');
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]!.closest('a')).toHaveAttribute('href', '/admin/cms/properties#properties');
  });
});
