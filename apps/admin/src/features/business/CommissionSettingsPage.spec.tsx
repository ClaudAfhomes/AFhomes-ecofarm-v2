import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { CommissionSettingsPage } from './CommissionSettingsPage';

const RULES = [
  {
    id: '11111111-0000-4000-8000-000000000001',
    targetType: 'role',
    targetId: '22222222-0000-4000-8000-000000000001',
    targetName: 'Sales Manager',
    rate: '0.0400',
    effectiveFrom: '2026-10-01',
    effectiveUntil: null,
    accreditedOnOrAfter: null,
    isActive: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: '11111111-0000-4000-8000-000000000002',
    targetType: 'staff',
    targetId: '22222222-0000-4000-8000-000000000002',
    targetName: 'ANA REYES',
    rate: '0.0500',
    effectiveFrom: '2026-10-01',
    effectiveUntil: '2026-12-31',
    accreditedOnOrAfter: '2026-09-01',
    isActive: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
  },
];

vi.mock('./services', () => ({
  getCommissionRules: vi.fn(async () => RULES),
  getCommissionRuleHistory: vi.fn(async () => [
    {
      id: 2,
      action: 'COMMISSION_RULE_UPDATED',
      actorId: 'actor-1',
      before: { rate: '0.0400', isActive: true },
      after: { rate: '0.0500', isActive: true },
      reason: null,
      createdAt: '2026-10-02T00:00:00.000Z',
    },
  ]),
  createCommissionRule: vi.fn(),
  updateCommissionRule: vi.fn(),
}));

const MANAGER: SessionUser = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Finance Admin',
  email: 'admin@afhomes.test',
  roleId: 'r-admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [
    {
      moduleKey: 'network.commissions',
      canView: true,
      canCreate: true,
      canUpdate: true,
      canDelete: false,
    },
  ],
};

afterEach(() => vi.clearAllMocks());

describe('CommissionSettingsPage', () => {
  it('summarizes rules and loads a rule into the editor on Edit', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    expect(await screen.findByText('Sales Manager')).toBeInTheDocument();
    expect(screen.getByLabelText('Active rules: 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Disabled rules: 1')).toBeInTheDocument();

    const row = screen.getByText('ANA REYES').closest('tr')!;
    expect(row.textContent).toMatch(/On\/after 2026-09-01/);
    await user.click(within(row).getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('heading', { name: 'Edit rule' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Rate \(0\.15 = 15%\)/)).toHaveValue('0.0500');
    expect(row).toHaveAttribute('data-editing');
    await user.click(screen.getByRole('button', { name: 'Cancel edit' }));
    expect(screen.getByRole('heading', { name: 'Add rule' })).toBeInTheDocument();
  });

  it('explains an invalid ID inline and keeps Add rule disabled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    await screen.findByText('Sales Manager');
    await user.type(screen.getByLabelText(/^Role\/account ID/), 'abc');
    expect(screen.getByText('Enter the full ID.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();
  });

  it('shows rule history as changed fields only', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    const row = (await screen.findByText('Sales Manager')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'History' }));

    const changes = await screen.findByRole('list', { name: 'Rule changes' });
    expect(within(changes).getByText('rate')).toBeInTheDocument();
    expect(within(changes).queryByText('isActive')).toBeNull();
    expect(within(changes).getByText('0.0400', { exact: false })).toBeInTheDocument();
    expect(within(changes).getByText('0.0500', { exact: false })).toBeInTheDocument();
  });
});
