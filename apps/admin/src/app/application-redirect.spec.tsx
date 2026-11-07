import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { Outlet, useLocation } from 'react-router';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import App from './App';

vi.mock('./RequireRole', () => ({ RequireRole: ({ children }: { children: ReactNode }) => children }));
vi.mock('./AdminLayout', () => ({ AdminLayout: Layout }));
vi.mock('../features/business/OfficialFormsPages', () => ({
  CustomerApplicationEditorPage: Location,
}));

function Location() {
  const location = useLocation();
  return <output>{location.pathname}{location.search}{location.hash}</output>;
}

function Layout() { return <Outlet />; }

it('keeps imported customer identity, row linkage and fragment through the legacy application redirect', async () => {
  const suffix = '?customerId=25501e42-02fc-4ba4-91af-1f9b30332d60&importRowId=d8b74068-9fba-4fc4-a5e2-d71fa90ffc37#identity';
  renderWithProviders(<App />, {
    route: `/admin/customers/applications/new${suffix}`,
    user: {
      id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic Admin',
      email: 'admin@example.invalid', roleId: 'admin', roleSlug: 'super_admin',
      roleName: 'Super Admin', status: 'active', afHomesPermissions: [],
    },
  });
  expect(await screen.findByText(`/admin/customers/new${suffix}`)).toBeInTheDocument();
});
