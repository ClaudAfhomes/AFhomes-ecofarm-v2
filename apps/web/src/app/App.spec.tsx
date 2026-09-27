import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test/utils';
import App from './App';

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.scrollTo = vi.fn() as never;
});

describe('public site shell', () => {
  it('serves the AF Homes public site at / without JAD branding', async () => {
    renderWithProviders(<App />);
    const main = await screen.findByRole('main', undefined, { timeout: 20000 });
    expect(
      within(main).getByText('Hospitality · Wellness · Dining · Nature — Laguna, Philippines'),
    ).toBeInTheDocument();
    expect(document.title).not.toMatch(/JA&D|JAD Realty/i);
    await vi.waitFor(() => expect(document.title).toContain('AFhomes'), { timeout: 20000 });
  });

  it('keeps the customer portal mounted under /customer', async () => {
    renderWithProviders(<App />, { route: '/customer/login' });
    expect(await screen.findByLabelText(/Email/)).toBeInTheDocument();
  });

  it('renders the marketing 404 for unknown paths', async () => {
    // The 404 page carries no <main> landmark by design.
    renderWithProviders(<App />, { route: '/definitely-not-a-page' });
    expect(
      await screen.findByRole(
        'heading',
        { name: 'This page is taking a rest day.' },
        { timeout: 20000 },
      ),
    ).toBeInTheDocument();
  });
});
