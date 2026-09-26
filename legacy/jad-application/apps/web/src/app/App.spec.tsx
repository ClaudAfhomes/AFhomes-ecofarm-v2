import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from './App';
import { renderWithProviders } from '../test/utils';

describe('App routing', () => {
  it.each([
    ['/', /where big dreams meet property/i],
    ['/about', /about ja&d/i],
    ['/properties', /properties & listings/i],
    ['/faqs', /frequently asked questions/i],
    ['/contact', /talk with ja&d realty services/i],
    ['/login', /welcome back/i],
    ['/register', /join ja&d/i],
  ])('renders the %s route', async (route, heading) => {
    renderWithProviders(<App />, { route });

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it('renders a property category page', async () => {
    renderWithProviders(<App />, { route: '/properties/income-generating-properties' });

    expect(
      await screen.findByRole('heading', { name: 'Income Generating Properties' }),
    ).toBeInTheDocument();
  });

  it('renders a property detail page', async () => {
    renderWithProviders(<App />, {
      route: '/properties/tenanted-condo-resales/prisma-astra-1br',
    });

    expect(
      await screen.findByRole('heading', { name: 'Prisma Residences - Astra Building Condo' }),
    ).toBeInTheDocument();
    expect(screen.getByText('₱5,300,000.00')).toBeInTheDocument();
  });

  it('renders the friendly 404 page for an unknown property route', async () => {
    renderWithProviders(<App />, {
      route: '/properties/tenanted-condo-resales/no-such-property',
    });

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('renders the friendly 404 page for an unknown route', async () => {
    renderWithProviders(<App />, { route: '/no-such-page' });

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
