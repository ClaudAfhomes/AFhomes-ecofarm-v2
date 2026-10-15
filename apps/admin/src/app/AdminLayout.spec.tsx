import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';

import { AdminLayout } from './AdminLayout';
import type { SessionUser } from '../lib/session';
import { renderWithProviders } from '../test/utils';

const USER: SessionUser = {
  id: 'u-1',
  name: 'Ana Reyes',
  email: 'ana@afhomes.test',
  roleId: 'r-admin',
  roleSlug: 'admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [
    {
      moduleKey: 'dashboard.view',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
};

function renderLayout() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<p>Page content</p>} />
      </Route>
    </Routes>,
    { route: '/admin', user: USER },
  );
}

describe('AdminLayout sidebar sign-out', () => {
  it('pins a Log Out action inside the sidebar, after the nav', () => {
    renderLayout();
    const sidebar = screen.getByRole('complementary', { name: 'AFHomes administration' });
    const logout = within(sidebar).getByRole('button', { name: 'Log Out' });
    const nav = sidebar.querySelector('nav');
    expect(nav).not.toBeNull();
    // The button follows the nav in document order: it lives in the rail
    // footer, the bottom part of the sidebar, on every page using this shell.
    expect(nav!.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the sign-out confirmation and closes it on cancel', () => {
    renderLayout();
    const sidebar = screen.getByRole('complementary', { name: 'AFHomes administration' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Log Out' }));
    expect(screen.getByText('Sign out?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Sign out?')).toBeNull();
  });

  it('renders a standalone denied page without sidebar or topbar', () => {
    renderWithProviders(
      <Routes>
        <Route path="/admin/staff" element={<AdminLayout />}>
          <Route index element={<p>Page content</p>} />
        </Route>
      </Routes>,
      { route: '/admin/staff', user: USER },
    );
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: 'AFHomes administration' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
