import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PropertiesPage } from './PropertiesPage';
import { renderWithProviders } from '../../../test/utils';

describe('PropertiesPage', () => {
  it('presents the three specialized property categories, each linking to its listing page', () => {
    renderWithProviders(<PropertiesPage />);

    expect(screen.getByRole('heading', { name: /properties & listings/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tenanted Condo Resales' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Income Generating Properties' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Developer Project Brokerage' }),
    ).toBeInTheDocument();

    for (const [title, slug, count] of [
      ['Tenanted Condo Resales', '/properties/tenanted-condo-resales', '5 properties'],
      ['Income Generating Properties', '/properties/income-generating-properties', '3 properties'],
      ['Developer Project Brokerage', '/properties/developer-project-brokerage', '2 properties'],
    ] as const) {
      const card = screen.getByRole('link', { name: new RegExp(title) });
      expect(card).toHaveAttribute('href', slug);
      expect(within(card).getByText(count)).toBeInTheDocument();
      expect(within(card).getByText('View Properties')).toBeInTheDocument();
    }
  });

  it('shows featured listings with prices and detail links', () => {
    renderWithProviders(<PropertiesPage />);

    // One featured property per category (first record in each).
    expect(
      screen.getByRole('heading', { name: 'Prisma Residences - Celeste Building Condo' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '250 SQM Farm Lot with Hotspring' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Mountain View Leisure Community' }),
    ).toBeInTheDocument();

    expect(screen.getByText('₱8,600,000.00')).toBeInTheDocument();
    expect(screen.queryByText('Sample listing')).not.toBeInTheDocument();

    for (const link of screen.getAllByRole('link', { name: 'View Details' })) {
      expect(link).toHaveAttribute('href', expect.stringMatching(/^\/properties\/.+\/.+$/));
    }
  });

  it('does not inflate the category card accessible names with image alt text', () => {
    renderWithProviders(<PropertiesPage />);

    const condominiumCard = screen.getByRole('link', { name: /tenanted condo resales/i });
    expect(condominiumCard).not.toHaveAccessibleName(/modern condominium tower/);

    const incomeCard = screen.getByRole('link', { name: /income generating properties/i });
    expect(incomeCard).not.toHaveAccessibleName(/scenic leisure property/);

    const brokerageCard = screen.getByRole('link', { name: /developer project brokerage/i });
    expect(brokerageCard).not.toHaveAccessibleName(/contemporary development building/);
  });

  it('contains no invented availability, rental, or per-area claims', () => {
    renderWithProviders(<PropertiesPage />);

    expect(screen.queryByText(/available now/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/per month/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/per sqm/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/for sale now/i)).not.toBeInTheDocument();
  });
});
