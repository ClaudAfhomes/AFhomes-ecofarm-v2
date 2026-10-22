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
  dailyLimitEnabled: true,
  privacyApproved: true,
  cleanupReady: true,
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
it('saves the controls including a disabled daily limit and displays them after reopening', async () => {
  const saved = { ...initial, enabled: true, dailyLimitEnabled: false, retentionDays: 90, revision: 2 };
  vi.mocked(savePublicVerificationSettings).mockResolvedValue(saved);
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  fireEvent.click(await screen.findByLabelText('Enable public IST/OST search'));
  fireEvent.click(screen.getByLabelText('Limit each IP address to 3 successful searches in 24 hours'));
  fireEvent.change(screen.getByLabelText('Contact retention (days)'), { target: { value: '90' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() =>
    expect(savePublicVerificationSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, dailyLimitEnabled: false, retentionDays: 90, expectedRevision: 1 }),
      expect.anything(),
    ),
  );
  cleanup();
  vi.mocked(getPublicVerificationSettings).mockResolvedValue(saved);
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  expect(await screen.findByLabelText('Enable public IST/OST search')).toBeChecked();
  expect(screen.getByLabelText('Contact retention (days)')).toHaveValue('90');
  expect(screen.getByLabelText('Limit each IP address to 3 successful searches in 24 hours')).not.toBeChecked();
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
  expect(screen.getByLabelText('Privacy notice approved')).toBeDisabled();
  expect(screen.getByLabelText('Limit each IP address to 3 successful searches in 24 hours')).toBeDisabled();
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
it('saves revoked privacy approval and displays it after reopening', async () => {
  const saved = { ...initial, privacyApproved: false, revision: 2 };
  vi.mocked(savePublicVerificationSettings).mockResolvedValue(saved);
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  fireEvent.click(await screen.findByLabelText('Privacy notice approved'));
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(savePublicVerificationSettings).toHaveBeenCalledWith(
    expect.objectContaining({privacyApproved:false}), expect.anything(),
  ));
  cleanup();
  vi.mocked(getPublicVerificationSettings).mockResolvedValue(saved);
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  expect(await screen.findByLabelText('Privacy notice approved')).not.toBeChecked();
});
it('shows cleanup readiness as automatic status without a writable checkbox', async () => {
  vi.mocked(getPublicVerificationSettings).mockResolvedValue({...initial,cleanupReady:false});
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  expect(await screen.findByText(/Cleanup not ready:/)).toBeVisible();
  expect(screen.queryByRole('checkbox',{name:/cleanup/i})).not.toBeInTheDocument();
});
