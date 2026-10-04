/**
 * Homepage + member login split (`/` and `/customer/login`).
 *
 * The root URL stays a homepage (same CMS hero copy/imagery, all sections
 * below) with the member sign-in beside the hero. Authenticated members get
 * a dashboard shortcut instead of a second form.
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

describe('homepage member login', () => {
  it('renders the hero marker exactly once beside the login panel', async () => {
    renderWithProviders(<App />, { route: '/' });
    const { main } = await chrome();
    expect(
      within(main).getByText('Hospitality · Wellness · Dining · Nature — Laguna, Philippines'),
    ).toBeInTheDocument();
    expect(within(main).getByText('Member Login')).toBeInTheDocument();
    expect(
      within(main).getByRole('heading', { name: 'Sign in to your card', level: 2 }),
    ).toBeInTheDocument();
    // The form is route-split: wait for the lazy chunk under parallel load.
    expect(await within(main).findByLabelText('Email')).toBeInTheDocument();
    expect(within(main).getByLabelText('Password')).toBeInTheDocument();
  });

  it('keeps the homepage sections below the split', async () => {
    renderWithProviders(<App />, { route: '/' });
    const { main } = await chrome();
    const scope = within(main);
    expect(scope.getByText('A pioneer in homestyle hospitality')).toBeInTheDocument();
    expect(scope.getByText('A destination, arriving in chapters.')).toBeInTheDocument();
    const tierLabels = await scope.findAllByText('VIP tier', undefined, { timeout: 20000 });
    expect(tierLabels).toHaveLength(3);
  });

  it('offers activation, staff and OST entries - and no admin entry', async () => {
    renderWithProviders(<App />, { route: '/' });
    const { main } = await chrome();
    const scope = within(main);
    expect(scope.getByRole('link', { name: /activate your membership/i })).toHaveAttribute(
      'href',
      '/customer/activate',
    );
    expect(
      scope.queryByRole('link', { name: /staff login|ost login|admin login/i }),
    ).not.toBeInTheDocument();
    expect(main.textContent).not.toMatch(/administration login|administration console/i);
  });

  it('shows a dashboard shortcut instead of the form when signed in', async () => {
    renderWithProviders(<App />, {
      route: '/',
      sessionUser: { authUserId: 'u', email: 'member@example.invalid' },
    });
    const { main } = await chrome();
    expect(
      await within(main).findByRole('heading', { name: 'You are signed in', level: 2 }),
    ).toBeInTheDocument();
    expect(
      await within(main).findByRole('link', { name: /go to your dashboard/i }),
    ).toHaveAttribute('href', '/customer');
    expect(within(main).queryByLabelText('Password')).not.toBeInTheDocument();
  });
});

describe('standalone member login', () => {
  it('renders the same split at /customer/login with noindex', async () => {
    renderWithProviders(<App />, { route: '/customer/login' });
    expect(
      await screen.findByRole('heading', { name: 'Sign in to your card', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });
});
