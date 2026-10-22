import { fireEvent, screen, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { PublicVerificationSettingsPage } from './PublicVerificationSettingsPage';
import { getPublicVerificationSettings, savePublicVerificationSettings } from './services';
vi.mock('./services', () => ({
  getPublicVerificationSettings: vi.fn(),
  savePublicVerificationSettings: vi.fn(),
}));
const initial = {
  enabled: false,
  verificationPhone: '+639604316867',
  retentionDays: 30,
  privacyNotice:
    'Finalized synthetic privacy notice with retention {{CONTACT_RETENTION_DAYS}} days. '.repeat(3),
  revision: 1,
  noticeVersion: 'v1',
  updatedAt: '2026-10-22T00:00:00.000Z',
};
const user = {
  id: 'admin',
  name: 'Configuration Admin',
  email: 'admin@example.invalid',
  roleId: 'role',
  roleSlug: 'super_admin',
  roleName: 'Super Admin',
  status: 'active' as const,
  afHomesPermissions: [
    {
      moduleKey: 'governance.config' as const,
      canView: true,
      canUpdate: true,
      canCreate: false,
      canDelete: false,
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPublicVerificationSettings).mockResolvedValue({ ...initial });
});
it('saves the four controls and displays their persisted values after reopening', async () => {
  const saved = { ...initial, enabled: true, retentionDays: 90, revision: 2 };
  vi.mocked(savePublicVerificationSettings).mockResolvedValue(saved);
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  fireEvent.click(await screen.findByLabelText('Enable public IST/OST search'));
  fireEvent.change(screen.getByLabelText('Contact retention (days)'), { target: { value: '90' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() =>
    expect(savePublicVerificationSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, retentionDays: 90, expectedRevision: 1 }),
      expect.anything(),
    ),
  );
  cleanup();
  vi.mocked(getPublicVerificationSettings).mockResolvedValue(saved);
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  expect(await screen.findByLabelText('Enable public IST/OST search')).toBeChecked();
  expect(screen.getByLabelText('Contact retention (days)')).toHaveValue('90');
});
it('does not load settings for staff outside the administrator roles', () => {
  renderWithProviders(<PublicVerificationSettingsPage />, {
    user: { ...user, roleSlug: 'finance' },
  });
  expect(screen.getByText('You cannot view verification settings.')).toBeVisible();
  expect(getPublicVerificationSettings).not.toHaveBeenCalled();
});
it('keeps the form read-only when configuration update is denied', async () => {
  renderWithProviders(<PublicVerificationSettingsPage />, { user: {...user,afHomesPermissions:[
    {...user.afHomesPermissions[0]!,canUpdate:false},
  ]} });
  expect(await screen.findByLabelText('Enable public IST/OST search')).toBeDisabled();
  expect(screen.getByLabelText('Privacy notice')).toBeDisabled();
  expect(screen.queryByRole('button',{name:'Save settings'})).not.toBeInTheDocument();
});
it('shows save errors and keeps the edited values available', async () => {
  vi.mocked(savePublicVerificationSettings).mockRejectedValue(
    new Error('Settings changed. Reload before saving again.'),
  );
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  await screen.findByLabelText('Contact retention (days)');
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(await screen.findByText('Settings changed. Reload before saving again.')).toBeVisible();
  expect(screen.getByLabelText('Contact retention (days)')).toHaveValue('30');
});
