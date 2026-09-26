import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';

import { CategoryPage } from './CategoryPage';
import { renderWithProviders } from '../../../test/utils';

function renderCategory(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/properties/:categorySlug" element={<CategoryPage />} />
    </Routes>,
    { route },
  );
}

describe('CategoryPage', () => {
  it('lists only the properties belonging to the category, each linking to its detail page', () => {
    renderCategory('/properties/tenanted-condo-resales');

    expect(screen.getByRole('heading', { name: 'Tenanted Condo Resales' })).toBeInTheDocument();
    expect(screen.getByText('5 properties in this category')).toBeInTheDocument();

    const expected = [
      '2-Storey House',
      'Prisma Residences - Astra Building Condo',
      'Levina Place - 2BR Condo',
    ];
    for (const name of expected) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    // Two Celeste Building units are listed (₱8.3M and ₱8.6M records).
    expect(
      screen.getAllByRole('heading', { name: 'Prisma Residences - Celeste Building Condo' }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole('heading', { name: 'Mountain View Leisure Community' }),
    ).not.toBeInTheDocument();

    for (const link of screen.getAllByRole('link', { name: 'View Details' })) {
      expect(link).toHaveAttribute(
        'href',
        expect.stringMatching(/^\/properties\/tenanted-condo-resales\/.+$/),
      );
    }
  });

  it('derives its listing from the category: income-generating properties are grouped correctly', () => {
    renderCategory('/properties/income-generating-properties');

    expect(
      screen.getByRole('heading', { name: 'Income Generating Properties' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '250 SQM Farm Lot with Hotspring' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Titled Hotspring Lots' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1,000 SQM Hotspring Lot' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View Details' })).toHaveLength(3);
  });

  it('lists each developer project offer with per-sqm pricing, never a total price', () => {
    renderCategory('/properties/developer-project-brokerage');

    expect(
      screen.getByRole('heading', { name: 'Mountain View Leisure Community' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mountain Suites' })).toBeInTheDocument();
    expect(screen.getByText('2 properties in this category')).toBeInTheDocument();
    expect(screen.queryByText('Sample listing')).not.toBeInTheDocument();
    expect(screen.getAllByText('₱6,860/sqm').length).toBeGreaterThan(0);
    expect(screen.queryByText(/₱\d{1,3}(,\d{3})*\.\d{2}/)).not.toBeInTheDocument();
  });

  it('keeps a clean heading hierarchy: h1 hero, h2 listing section, h3 cards', () => {
    renderCategory('/properties/tenanted-condo-resales');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Tenanted Condo Resales' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Properties in Tenanted Condo Resales' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '2-Storey House' })).toBeInTheDocument();
  });

  it('renders the friendly not-found state for an unknown category', () => {
    renderCategory('/properties/no-such-category');

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
