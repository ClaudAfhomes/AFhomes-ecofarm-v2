import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HomePage } from './HomePage';
import { renderWithProviders } from '../../../test/utils';

describe('HomePage', () => {
  it('renders the hero with the brand positioning', () => {
    renderWithProviders(<HomePage />);

    expect(
      screen.getByRole('heading', { name: /where big dreams meet property that already earns/i }),
    ).toBeInTheDocument();
  });

  it('links to the approved public pages', () => {
    renderWithProviders(<HomePage />);

    expect(screen.getByRole('link', { name: 'Explore Properties' })).toHaveAttribute(
      'href',
      '/properties',
    );
    for (const link of screen.getAllByRole('link', { name: 'Discover JA&D' })) {
      expect(link).toHaveAttribute('href', '/about');
    }
    for (const link of screen.getAllByRole('link', { name: 'Talk to Us' })) {
      expect(link).toHaveAttribute('href', '/contact');
    }
  });

  it('presents the three specialized property categories linking to their listing pages', () => {
    renderWithProviders(<HomePage />);

    expect(screen.getByRole('heading', { name: 'Tenanted Condo Resales' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Income Generating Properties' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Developer Project Brokerage' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Explore the types of properties we specialize in.'),
    ).toBeInTheDocument();

    for (const [title, slug] of [
      ['Tenanted Condo Resales', '/properties/tenanted-condo-resales'],
      ['Income Generating Properties', '/properties/income-generating-properties'],
      ['Developer Project Brokerage', '/properties/developer-project-brokerage'],
    ] as const) {
      const card = screen.getByRole('link', { name: new RegExp(title) });
      expect(card).toHaveAttribute('href', slug);
      expect(within(card).getByText('View Properties')).toBeInTheDocument();
    }
  });

  it('shows featured listings with prices and detail links', () => {
    renderWithProviders(<HomePage />);

    expect(screen.queryByText('Sample listing')).not.toBeInTheDocument();
    expect(screen.getByText('₱8,600,000.00')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View Details' }).length).toBeGreaterThan(0);
    for (const link of screen.getAllByRole('link', { name: 'View Details' })) {
      expect(link).toHaveAttribute('href', expect.stringMatching(/^\/properties\/.+\/.+$/));
    }

    expect(screen.queryByText(/available now/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/per month/i)).not.toBeInTheDocument();
  });

  it('supports each trust pillar with a decorative icon', () => {
    renderWithProviders(<HomePage />);

    const trustSection = screen
      .getByRole('heading', { name: /a brokerage you can hold accountable/i })
      .closest('section');
    expect(trustSection).not.toBeNull();

    const pillarSvgs = trustSection!.querySelectorAll('ul li svg');
    expect(pillarSvgs.length).toBe(4);
    for (const svg of pillarSvgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
    }
  });
});
