import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { AfHomesPermission } from '@jad/contracts';
import { SessionProvider, type SessionUser } from '../lib/session';
import { RequireRole } from './RequireRole';

const session = (permissions: AfHomesPermission[]): SessionUser => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Owner',
  email: 'owner@example.com',
  roleId: '00000000-0000-4000-8000-000000000002',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: permissions,
});
const view = (moduleKey: AfHomesPermission['moduleKey']): AfHomesPermission => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});
function renderPath(user: SessionUser, path = '/admin/roles') {
  return render(
    <SessionProvider initialUser={user}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={path}
            element={
              <RequireRole>
                <div>protected content</div>
              </RequireRole>
            }
          />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe('AF Homes direct URL guard', () => {
  it('allows a directly requested route only with its server-resolved module', async () => {
    renderPath(session([view('organization.roles')]));
    expect(await screen.findByText('protected content')).toBeInTheDocument();
  });
  it('denies a direct URL when its module is absent', async () => {
    renderPath(session([view('dashboard.view')]));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });
});
