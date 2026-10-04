import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { RequireRole } from './RequireRole';

const security = vi.hoisted(() => ({ mustChangePassword: true, mfaRequired: true }));
vi.mock('../lib/session', () => ({
  useSession: () => ({
    status: 'authenticated',
    sessionError: false,
    revalidate: vi.fn(),
    user: {
      roleSlug: 'admin',
      afHomesPermissions: [
        {
          moduleKey: 'dashboard.view',
          canView: true,
          canCreate: false,
          canUpdate: false,
          canDelete: false,
        },
      ],
      ...security,
    },
  }),
}));
beforeEach(() => {
  security.mustChangePassword = true;
  security.mfaRequired = true;
});
function renderProfile() {
  render(
    <MemoryRouter initialEntries={['/admin/profile']}>
      <Routes>
        <Route
          path="/admin/profile"
          element={
            <RequireRole>
              <p>Password setup</p>
            </RequireRole>
          }
        />
        <Route path="/admin/mfa" element={<p>Authenticator setup</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
it('allows password setup first when both password change and MFA are required', () => {
  renderProfile();
  expect(screen.getByText('Password setup')).toBeInTheDocument();
  expect(screen.queryByText('Authenticator setup')).not.toBeInTheDocument();
});
it('requires MFA after password setup completes', () => {
  security.mustChangePassword = false;
  renderProfile();
  expect(screen.getByText('Authenticator setup')).toBeInTheDocument();
  expect(screen.queryByText('Password setup')).not.toBeInTheDocument();
});
it('allows the profile after both security checks complete', () => {
  security.mustChangePassword = false;
  security.mfaRequired = false;
  renderProfile();
  expect(screen.getByText('Password setup')).toBeInTheDocument();
});
