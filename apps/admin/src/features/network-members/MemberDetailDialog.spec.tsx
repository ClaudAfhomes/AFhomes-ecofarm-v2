import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { memberSchema, type AfHomesPermission } from '@afhomes/contracts';
import { renderWithProviders } from '../../test/utils';
import { MemberDetailDialog } from './MemberDetailDialog';
import { getMember } from './services';

vi.mock('./services', async (original) => ({
  ...(await original<typeof import('./services')>()),
  getMember: vi.fn(),
}));
const ost = memberSchema.parse({
  ...Object.fromEntries(Object.keys(memberSchema.shape).map((key) => [key, null])),
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'SYNTHETIC OST',
  email: 'ost@example.invalid',
  position: 'ost',
  positionLabel: 'OST',
  status: 'active',
  createdAt: '2026-01-01',
});
const permissions: AfHomesPermission[] = ['network.ost_registrations', 'network.ost_members'].map(
  (moduleKey) => ({
    moduleKey: moduleKey as AfHomesPermission['moduleKey'],
    canView: true,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  }),
);
/** The OST console right the conversion needs on top of the administrator role. */
const updaterGrants: AfHomesPermission[] = [
  ...permissions,
  {
    moduleKey: 'network.members',
    canView: true,
    canCreate: false,
    canUpdate: true,
    canDelete: false,
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMember).mockResolvedValue({ ...ost, tin: null, governmentIdNumber: null });
});
function show(member = ost, grants = permissions, roleSlug = 'admin', onConvertToIst = vi.fn()) {
  const onClose = vi.fn();
  renderWithProviders(
    <Routes>
      <Route
        path="/admin/network/members"
        element={
          <MemberDetailDialog
            member={member}
            onClose={onClose}
            onChanged={vi.fn()}
            onConvertToIst={onConvertToIst}
          />
        }
      />
      <Route path="/admin/ost/members/:id" element={<p>Existing OST renewal page</p>} />
    </Routes>,
    {
      route: '/admin/network/members',
      user: {
        id: 'staff',
        name: 'Reviewer',
        email: 'reviewer@example.invalid',
        roleId: 'role',
        roleSlug,
        roleName: 'Reviewer',
        status: 'active',
        afHomesPermissions: grants,
      },
    },
  );
  return { onClose, onConvertToIst };
}
it('opens the existing OST renewal route and closes the member dialog', async () => {
  const { onClose: close } = show();
  fireEvent.click(screen.getByRole('button', { name: 'Renewal' }));
  expect(await screen.findByText('Existing OST renewal page')).toBeVisible();
  expect(close).toHaveBeenCalledOnce();
});
it('does not offer OST renewal for IST members', () => {
  show({ ...ost, position: 'sales_manager', positionLabel: 'Sales Manager' });
  expect(screen.queryByRole('button', { name: 'Renewal' })).not.toBeInTheDocument();
});
it.each(['network.ost_registrations', 'network.ost_members'])(
  'hides the shortcut without %s view permission',
  (missing) => {
    show(
      ost,
      permissions.filter((p) => p.moduleKey !== missing),
    );
    expect(screen.queryByRole('button', { name: 'Renewal' })).not.toBeInTheDocument();
  },
);
it('offers the conversion to IST to an administrator with the update right', () => {
  const { onConvertToIst } = show(ost, updaterGrants, 'admin');
  fireEvent.click(screen.getByRole('button', { name: 'Transfer to IST' }));
  expect(onConvertToIst).toHaveBeenCalledWith(ost);
});
it('hides the conversion without the update right', () => {
  show(ost, permissions, 'admin');
  expect(screen.queryByRole('button', { name: 'Transfer to IST' })).not.toBeInTheDocument();
});
it('hides the conversion outside the administrator roles', () => {
  show(ost, updaterGrants, 'staff');
  expect(screen.queryByRole('button', { name: 'Transfer to IST' })).not.toBeInTheDocument();
});
it('does not offer the conversion for IST members', () => {
  show(
    { ...ost, position: 'sales_manager', positionLabel: 'Sales Manager' },
    updaterGrants,
    'admin',
  );
  expect(screen.queryByRole('button', { name: 'Transfer to IST' })).not.toBeInTheDocument();
});
