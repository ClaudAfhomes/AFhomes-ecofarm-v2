/**
 * Homepage hero (`/`) and fullscreen member login (`/customer/login`).
 *
 * The root URL is the pure marketing homepage: the same CMS hero copy and
 * imagery with no sign-in form. Member sign-in lives behind the navbar Login
 * entry at `/customer/login`, a fullscreen screen outside the marketing
 * shell. Authenticated members visiting `/customer/login` resolve to their
 * dashboard instead of a second form.
 */
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
vi.mock('../../lib/portals', () => ({
  getAuthPortals: vi.fn(async () => ({ staff: null, customer: { status: 'active' }, ost: null })),
}));

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
  localStorage.clear();
});

const chrome = async () => {
  const main = await screen.findByRole('main', undefined, { timeout: 20000 });
  return { main };
};

describe('homepage hero', () => {
  it('renders the marketing hero with no sign-in form', async () => {
    renderWithProviders(<App />, { route: '/' });
    const { main } = await chrome();
    expect(
      within(main).getByText('Hospitality · Wellness · Dining · Nature — Laguna, Philippines'),
    ).toBeInTheDocument();
    expect(within(main).queryByText('Member Login')).not.toBeInTheDocument();
    expect(within(main).queryByLabelText('Email')).not.toBeInTheDocument();
    expect(within(main).queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('keeps the homepage sections below the hero', async () => {
    renderWithProviders(<App />, { route: '/' });
    const { main } = await chrome();
    const scope = within(main);
    expect(scope.getByText('A pioneer in homestyle hospitality')).toBeInTheDocument();
    expect(scope.getByText('A destination, arriving in chapters.')).toBeInTheDocument();
    const tierLabels = await scope.findAllByText('VIP tier', undefined, { timeout: 20000 });
    expect(tierLabels).toHaveLength(3);
  });

  it('advertises no staff, OST or admin entries', async () => {
    renderWithProviders(<App />, { route: '/' });
    const { main } = await chrome();
    expect(
      within(main).queryByRole('link', { name: /staff login|ost login|admin login/i }),
    ).not.toBeInTheDocument();
    expect(main.textContent).not.toMatch(/administration login|administration console/i);
  });

  it('renders the same hero for signed-in members, still with no form', async () => {
    renderWithProviders(<App />, {
      route: '/',
      sessionUser: { authUserId: 'u', email: 'member@example.invalid' },
    });
    const { main } = await chrome();
    expect(
      within(main).getByText('Hospitality · Wellness · Dining · Nature — Laguna, Philippines'),
    ).toBeInTheDocument();
    expect(within(main).queryByLabelText('Password')).not.toBeInTheDocument();
  });
});

describe('standalone member login', () => {
  it('renders the fullscreen login screen at /customer/login with noindex', async () => {
    renderWithProviders(<App />, { route: '/customer/login' });
    expect(
      await screen.findByRole('heading', { name: 'Sign in to your card', level: 1 }),
    ).toBeInTheDocument();
    // The form is route-split: wait for the lazy chunk under parallel load.
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });

  it('offers activation from the login screen - and no admin entry', async () => {
    renderWithProviders(<App />, { route: '/customer/login' });
    expect(await screen.findByRole('link', { name: /activate your membership/i })).toHaveAttribute(
      'href',
      '/customer/activate',
    );
    expect(
      screen.queryByRole('link', { name: /staff login|ost login|admin login/i }),
    ).not.toBeInTheDocument();
  });

  it('breadcrumbs Home > Customer Login above the form', async () => {
    renderWithProviders(<App />, { route: '/customer/login' });
    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(within(nav).getByText('Customer Login')).toHaveAttribute('aria-current', 'page');
  });
});
