import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLocation } from 'react-router';

import { renderWithProviders } from '../test/utils';
import App from './App';

const superAdmin = {
  id: 'staff-1',
  name: 'Super Admin',
  email: 'owner@afhomes.test',
  roleId: 'role-1',
  roleName: 'Super Admin',
  status: 'active' as const,
  afHomesPermissions: [
    {
      moduleKey: 'dashboard.view' as const,
      canView: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
    },
  ],
};

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

describe('admin authentication routes', () => {
  it('renders the administration login page at /admin/login', async () => {
    renderWithProviders(<App />, { route: '/admin/login' });
    expect(await screen.findByRole('heading', { name: 'Admin Login' })).toBeInTheDocument();
  });

  it('redirects an unauthenticated /admin request to the administration login page', async () => {
    renderWithProviders(<App />, { route: '/admin' });
    expect(await screen.findByRole('heading', { name: 'Admin Login' })).toBeInTheDocument();
  });

  it('redirects an unauthenticated nested admin route to the same login page', async () => {
    renderWithProviders(<App />, { route: '/admin/products' });
    expect(await screen.findByRole('heading', { name: 'Admin Login' })).toBeInTheDocument();
  });

  it('redirects an authenticated Super Admin away from login to the dashboard', async () => {
    renderWithProviders(
      <>
        <App />
        <LocationProbe />
      </>,
      { route: '/admin/login', user: superAdmin },
    );
    expect(await screen.findByTestId('location')).toHaveTextContent('/admin');
  });

  it('keeps unknown admin routes as not found for a signed-in user', async () => {
    renderWithProviders(<App />, { route: '/admin/not-a-route', user: superAdmin });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('sends a signed-out visitor on an unknown admin route to sign in, not an empty shell', async () => {
    renderWithProviders(<App />, { route: '/admin/not-a-route' });
    expect(await screen.findByRole('heading', { name: 'Admin Login' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument();
  });
});
