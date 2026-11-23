import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURE_FLAGS, FEATURE_FLAGS, setFeatureFlags } from '@afhomes/shared';

import { renderWithProviders } from '../../test/utils';
import { request } from '../../lib/api/client';
import { ModuleSettingsPage } from './ModuleSettingsPage';

vi.mock('../../lib/api/client', async (original) => ({
  ...(await original<typeof import('../../lib/api/client')>()),
  request: vi.fn(),
}));
vi.mock('@afhomes/ui', async (original) => ({
  ...(await original<typeof import('@afhomes/ui')>()),
  notifySuccess: vi.fn(),
}));

const ALL_ON = { ...DEFAULT_FEATURE_FLAGS };
const permission = (canUpdate: boolean) => ({
  id: 'admin',
  name: 'Configuration Admin',
  email: 'admin@example.invalid',
  roleId: 'role',
  roleSlug: 'admin',
  roleName: 'Admin',
  status: 'active' as const,
  afHomesPermissions: [
    {
      moduleKey: 'governance.config' as const,
      canView: true,
      canUpdate,
      canCreate: false,
      canDelete: false,
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(request).mockImplementation(async (_path, _schema, init) =>
    init?.method === 'PUT' ? { ...ALL_ON, ...JSON.parse(String(init.body)) } : { ...ALL_ON },
  );
});
afterEach(() => setFeatureFlags(DEFAULT_FEATURE_FLAGS));

it('turns a module off only after confirming, sends just that switch, then reloads', async () => {
  const reload = vi.fn();
  renderWithProviders(<ModuleSettingsPage reload={reload} />, { user: permission(true) });
  const save = await screen.findByRole('button', { name: 'Save changes' });
  expect(save).toBeDisabled();

  fireEvent.click(screen.getByRole('switch', { name: /Points redemption/ }));
  fireEvent.click(save);
  expect(await screen.findByText('Turn modules off?')).toBeInTheDocument();
  expect(request).not.toHaveBeenCalledWith(
    '/settings/features',
    expect.anything(),
    expect.objectContaining({ method: 'PUT' }),
  );

  fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(request).toHaveBeenCalledWith(
    '/settings/features',
    expect.anything(),
    expect.objectContaining({ method: 'PUT', body: JSON.stringify({ redemption: false }) }),
  );
  expect(FEATURE_FLAGS.redemption).toBe(false);
});

it('turns a module on without a confirmation', async () => {
  vi.mocked(request).mockImplementation(async (_path, _schema, init) =>
    init?.method === 'PUT'
      ? { ...ALL_ON, cms: false, ...JSON.parse(String(init.body)) }
      : { ...ALL_ON, cms: false },
  );
  const reload = vi.fn();
  renderWithProviders(<ModuleSettingsPage reload={reload} />, { user: permission(true) });
  fireEvent.click(await screen.findByRole('switch', { name: /Website content/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(screen.queryByText('Turn modules off?')).toBeNull();
  expect(request).toHaveBeenCalledWith(
    '/settings/features',
    expect.anything(),
    expect.objectContaining({ method: 'PUT', body: JSON.stringify({ cms: true }) }),
  );
});

it('lists a switch for every module and explains the parts that are always on', async () => {
  renderWithProviders(<ModuleSettingsPage reload={vi.fn()} />, { user: permission(true) });
  for (const name of [
    /Sales and customers/,
    /^Finance/,
    /IST payroll/,
    /^Commissions/,
    /Services and points earning/,
    /Points redemption/,
    /Sales network/,
    /^Reports/,
    /Website content/,
  ])
    expect(await screen.findByRole('switch', { name })).toBeChecked();
  expect(screen.getAllByRole('switch')).toHaveLength(9);
  expect(screen.getByText('Audit log')).toBeInTheDocument();
  expect(screen.getByText(/lock administrators out/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch', { name: /IST payroll/ }));
  expect(screen.getByText(/1 unsaved change: IST payroll off/)).toBeInTheDocument();
});

it('is read-only without the update permission', async () => {
  renderWithProviders(<ModuleSettingsPage reload={vi.fn()} />, { user: permission(false) });
  expect(await screen.findByRole('switch', { name: /^Reports/ })).toBeDisabled();
  expect(screen.getByText('You can view these switches but not change them.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});
