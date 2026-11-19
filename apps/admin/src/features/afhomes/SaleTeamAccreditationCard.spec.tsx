import { beforeEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import { SaleTeamAccreditationCard } from './SaleTeamAccreditationCard';
import type { SessionUser } from '../../lib/session';
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/client')>()),
  protectedRequest: api.request,
}));
const admin: SessionUser = {
  id: 'admin',
  name: 'ADMIN',
  email: 'admin@example.invalid',
  roleId: 'role',
  roleSlug: 'admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [
    {
      moduleKey: 'organization.staff',
      canView: true,
      canCreate: true,
      canUpdate: true,
      canDelete: false,
    },
  ],
};
const record = {
  aaNumber: 'AA-K7Q2M9T4B1R8',
  fullName: 'SYNTHETIC SELLER',
  kind: 'IST',
  status: 'accredited',
  startsOn: '2026-01-01',
  expiresOn: '2027-12-31',
};
beforeEach(() => {
  api.request.mockReset();
});
it('shows the own AA without editing or approval controls', async () => {
  api.request.mockResolvedValue(record);
  renderWithProviders(<SaleTeamAccreditationCard kind="IST" />, { user: admin });
  expect(await screen.findByText(record.aaNumber)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  expect(api.request).toHaveBeenCalledWith('/sale-team/me', expect.anything());
});
it('displays the official IST number on the own account', async () => {
  api.request.mockResolvedValue({ ...record, aaNumber: 'AAI26100001' });
  renderWithProviders(<SaleTeamAccreditationCard kind="IST" />, { user: admin });
  expect(await screen.findByText('AAI26100001')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy ID AAI26100001' })).toBeInTheDocument();
  expect(screen.queryByText(/Legacy ID/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
});
it('issues IST employee identity after explicit confirmation without accreditation dates', async () => {
  api.request.mockImplementation((_path: string, _schema: unknown, init?: RequestInit) =>
    Promise.resolve(init ? record : null),
  );
  renderWithProviders(<SaleTeamAccreditationCard staffId="seller" kind="IST" />, { user: admin });
  const button = await screen.findByRole('button', { name: 'Issue employee AAI number' });
  expect(button).toBeEnabled();
  expect(screen.queryByLabelText('Approved start')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Approved expiry')).not.toBeInTheDocument();
  await userEvent.click(button);
  expect(api.request).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      '/sale-team/seller',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'approve',
          kind: 'IST',
        }),
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(api.request).toHaveBeenCalledTimes(3));
});
it('shows missing issuance and a retryable load error distinctly', async () => {
  api.request.mockRejectedValue(new Error('Unavailable'));
  renderWithProviders(<SaleTeamAccreditationCard kind="IST" />, { user: admin });
  expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  expect(screen.queryByText('AA number not yet issued')).not.toBeInTheDocument();
});

it('shows confirmed unissued accreditation without fabricating an identifier', async () => {
  api.request.mockResolvedValue(null);
  renderWithProviders(<SaleTeamAccreditationCard kind="IST" />, { user: admin });
  expect(await screen.findByText('Not Yet Issued')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Copy ID/ })).not.toBeInTheDocument();
});
