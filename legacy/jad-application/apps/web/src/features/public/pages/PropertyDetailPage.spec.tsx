import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';

import { PropertyDetailPage } from './PropertyDetailPage';
import { renderWithProviders } from '../../../test/utils';

function renderDetail(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/properties/:categorySlug/:propertySlug" element={<PropertyDetailPage />} />
    </Routes>,
    { route },
  );
}

describe('PropertyDetailPage', () => {
  it('renders the correct property data for the route slug', () => {
    renderDetail('/properties/tenanted-condo-resales/prisma-astra-1br');

    const heading = screen.getByRole('heading', {
      name: 'Prisma Residences - Astra Building Condo',
    });
    expect(heading).toBeInTheDocument();
    expect(screen.getAllByText('Pasig City').length).toBeGreaterThan(0);
    expect(screen.getByText('₱5,300,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('28 m²').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tenanted Condo Resales').length).toBeGreaterThan(0);
  });

  it('shows key facts, overview, highlights, and the Message Us CTA', () => {
    renderDetail('/properties/tenanted-condo-resales/prisma-celeste-8-3m');

    expect(screen.getByRole('heading', { name: 'About this property' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Key characteristics' })).toBeInTheDocument();
    expect(screen.getByText('2 bedrooms')).toBeInTheDocument();
    expect(screen.getByText('56 sqm floor area')).toBeInTheDocument();
    expect(screen.getAllByText(/active lease contract/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Message Us' })).toBeInTheDocument();
  });

  it('links Message Us to Messenger and links back to the category', () => {
    renderDetail('/properties/tenanted-condo-resales/levina-place-2br');

    const message = screen.getByRole('link', { name: 'Message Us' });
    expect(message).toHaveAttribute('href', 'https://m.me/JADRealtyServices');
    expect(message).toHaveAttribute('target', '_blank');
    expect(message).toHaveAttribute('rel', 'noopener noreferrer');

    const back = screen.getByRole('link', { name: 'Back to Tenanted Condo Resales' });
    expect(back).toHaveAttribute('href', '/properties/tenanted-condo-resales');
  });

  it('shows related properties from the catalog', () => {
    renderDetail('/properties/tenanted-condo-resales/prisma-celeste-8-6m');

    const related = screen.getByRole('heading', { name: 'Related properties' });
    const grid = related.closest('section');
    expect(grid).not.toBeNull();
    // Sibling properties in the same category (first 3, current excluded).
    expect(
      within(grid!).getByRole('heading', { name: 'Levina Place - 2BR Condo' }),
    ).toBeInTheDocument();
    expect(
      within(grid!).getByRole('heading', { name: 'Prisma Residences - Celeste Building Condo' }),
    ).toBeInTheDocument();
    expect(
      within(grid!).getByRole('heading', { name: 'Prisma Residences - Astra Building Condo' }),
    ).toBeInTheDocument();
    expect(
      within(grid!).queryByRole('heading', { name: '2-Storey House' }),
    ).not.toBeInTheDocument();
  });

  it('renders developer projects without a price', () => {
    renderDetail('/properties/developer-project-brokerage/mountain-view-leisure-community');

    expect(
      screen.getByRole('heading', { name: 'Mountain View Leisure Community' }),
    ).toBeInTheDocument();
    expect(screen.getByText('0001950')).toBeInTheDocument();
    expect(screen.queryByText('₱6,000,000.00')).not.toBeInTheDocument();
  });

  it('renders the friendly not-found state for an unknown property or mismatched category', () => {
    const first = renderDetail('/properties/tenanted-condo-resales/no-such-property');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    first.unmount();

    renderDetail('/properties/developer-project-brokerage/prisma-astra-1br');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
