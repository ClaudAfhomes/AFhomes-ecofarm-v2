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
  supportHeading: 'Customer Support & Payment Inquiries',
  supportEmail: 'info@afhomes.com.ph',
  supportPhone: '+63 960 431 6867',
  bankHolder: 'AFhomes Hotspring & Ecofarm Resort Corp.',
  bank1Name: 'SECURITY BANK',
  bank1Account: '0000082595577',
  bank2Name: 'CHINABANK',
  bank2Account: '150700006468',
  checkPayee: 'AFhomes Hotspring & Ecofarm Resort Corp.',
  bankReminder: 'Please double-check the provided company bank account details before sending any payment. Thank you!',
  agentReminder: 'A friendly reminder: All agents are strictly prohibited from directly collecting payments from buyers.',
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
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
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
it('shows a skeleton while loading, then the form', async () => {
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  expect(screen.getByRole('status', { name: 'Loading settings' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByLabelText('Enable public IST/OST search')).not.toBeInTheDocument();
  expect(await screen.findByLabelText('Enable public IST/OST search')).toBeVisible();
  expect(screen.queryByRole('status', { name: 'Loading settings' })).not.toBeInTheDocument();
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
  expect(screen.getByLabelText('Privacy notice (edit mode)')).toBeDisabled();
  expect(screen.getByLabelText('Privacy notice approved')).toBeDisabled();
  expect(screen.getByLabelText('Limit each IP address to 3 successful searches in 24 hours')).toBeDisabled();
  expect(screen.queryByRole('button',{name:'Save Changes'})).not.toBeInTheDocument();
});
it('shows save errors and keeps the edited values available', async () => {
  vi.mocked(savePublicVerificationSettings).mockRejectedValue(
    new Error('Settings changed. Reload before saving again.'),
  );
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  fireEvent.change(await screen.findByLabelText('Contact retention (days)'), { target: { value: '45' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(await screen.findByText(/Settings changed. Reload before saving again/i)).toBeVisible();
  expect(screen.getByLabelText('Contact retention (days)')).toHaveValue('45');
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Discard edits and reload' })).toBeVisible();
});
it('disables Save until a change is made, and again when it is reverted', async () => {
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  const days = await screen.findByLabelText('Contact retention (days)');
  const saveButton = screen.getByRole('button', { name: 'Save Changes' });
  expect(saveButton).toBeDisabled();
  expect(screen.queryByText('You have unsaved changes.')).not.toBeInTheDocument();
  fireEvent.change(days, { target: { value: '31' } });
  expect(saveButton).toBeEnabled();
  expect(screen.getByText('You have unsaved changes.')).toBeVisible();
  fireEvent.change(days, { target: { value: '30' } });
  expect(saveButton).toBeDisabled();
  fireEvent.change(days, { target: { value: ' 30 ' } });
  expect(saveButton).toBeDisabled();
});
it('shows a busy spinner and blocks a second save while saving', async () => {
  let finish: (v: typeof initial) => void = () => undefined;
  vi.mocked(savePublicVerificationSettings).mockReturnValue(new Promise((r) => { finish = r; }));
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  fireEvent.change(await screen.findByLabelText('Contact retention (days)'), { target: { value: '31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  const busy = await screen.findByRole('button', { busy: true });
  expect(busy).toBeDisabled();
  fireEvent.click(busy);
  expect(savePublicVerificationSettings).toHaveBeenCalledTimes(1);
  finish({ ...initial, retentionDays: 31, revision: 2 });
  // The success toast hides the page from role queries, so use text queries.
  const button = () => screen.getByText('Save Changes').closest('button');
  await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
  expect(button()).toBeDisabled();
  expect(screen.getByLabelText('Contact retention (days)')).toHaveValue('31');
});
it('marks the invalid field and does not call save', async () => {
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  const days = await screen.findByLabelText('Contact retention (days)');
  fireEvent.change(days, { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(await screen.findByText('Check the marked fields.')).toBeVisible();
  expect(days).toHaveAttribute('aria-invalid', 'true');
  expect(days).toHaveFocus();
  expect(savePublicVerificationSettings).not.toHaveBeenCalled();
});
it('saves revoked privacy approval and displays it after reopening', async () => {
  const saved = { ...initial, privacyApproved: false, revision: 2 };
  vi.mocked(savePublicVerificationSettings).mockResolvedValue(saved);
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  fireEvent.click(await screen.findByLabelText('Privacy notice approved'));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
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
it('preserves line breaks in the privacy notice preview', async () => {
  const notice = 'Line one\n\nLine two\nLine three';
  vi.mocked(getPublicVerificationSettings).mockResolvedValue({ ...initial, privacyNotice: notice });
  renderWithProviders(<PublicVerificationSettingsPage />, { user });
  fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }));
  const preview = await screen.findByText(/Line one/);
  expect(preview.textContent).toBe(notice);
});
