import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import {
  bulkSetCommissionRate,
  createCommissionRule,
  getCommissionRoster,
  updateCommissionRule,
} from './services';
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

const ANA = '33333333-0000-4000-8000-000000000001';
const BEN = '33333333-0000-4000-8000-000000000002';
const ROSTER = {
  positions: [
    {
      roleId: '22222222-0000-4000-8000-000000000001',
      slug: 'sales_manager',
      name: 'Sales Manager',
      memberCount: 1,
      defaultRuleId: RULES[0]!.id,
      defaultRate: '0.0400',
    },
    {
      roleId: '22222222-0000-4000-8000-000000000009',
      slug: 'ost',
      name: 'OST',
      memberCount: 1,
      defaultRuleId: null,
      defaultRate: null,
    },
  ],
  members: [
    {
      id: ANA,
      name: 'Ana Reyes',
      positionSlug: 'ost',
      positionName: 'OST',
      salesCount: 3,
      lastSaleAt: '2026-10-20T00:00:00.000Z',
      rate: '0',
      source: 'none',
      ruleId: null,
    },
    {
      id: BEN,
      name: 'Ben Cruz',
      positionSlug: 'sales_manager',
      positionName: 'Sales Manager',
      salesCount: 0,
      lastSaleAt: null,
      rate: '0.0400',
      source: 'position',
      ruleId: RULES[0]!.id,
    },
  ],
  total: 2,
  limit: 25,
  offset: 0,
  needsRateCount: 1,
};

const { notifyConfirm, notifySuccess, notifyError } = vi.hoisted(() => ({
  notifyConfirm: vi.fn(async () => true),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock('@afhomes/ui', async (original) => ({
  ...(await original<typeof import('@afhomes/ui')>()),
  notifyConfirm,
  notifySuccess,
  notifyError,
}));

vi.mock('./services', () => ({
  getCommissionRules: vi.fn(async () => RULES),
  getCommissionRoster: vi.fn(async () => ROSTER),
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
  createCommissionRule: vi.fn(async () => RULES[0]),
  updateCommissionRule: vi.fn(async () => RULES[0]),
  bulkSetCommissionRate: vi.fn(async () => ({ created: 1, replaced: 0 })),
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

afterEach(() => {
  vi.clearAllMocks();
  notifyConfirm.mockResolvedValue(true);
});

const openTab = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole('tab', { name }));

describe('CommissionSettingsPage', () => {
  it('shows position rates, sellers with their applied rate, and the 0% notice', async () => {
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    const row = (await screen.findByText('Ana Reyes')).closest('tr')!;
    expect(row.textContent).toMatch(/3/);
    expect(within(row).getByText('No rate')).toBeInTheDocument();
    const ben = screen.getByText('Ben Cruz').closest('tr')!;
    expect(within(ben).getByText('4.00%')).toBeInTheDocument();
    expect(within(ben).getByText('Position')).toBeInTheDocument();
    expect(screen.getByText('1 seller has sales at 0%')).toBeInTheDocument();
    expect(screen.getByText('Need a rate: 1')).toBeInTheDocument();
  });

  it('updates an existing position rate and creates a missing one', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    await screen.findByText('Ana Reyes');
    await openTab(user, 'Position rates');

    await user.clear(screen.getByLabelText('Sales Manager rate (%)'));
    await user.type(screen.getByLabelText('Sales Manager rate (%)'), '5');
    await user.click(screen.getByRole('button', { name: 'Save Sales Manager rate' }));
    await waitFor(() =>
      expect(updateCommissionRule).toHaveBeenCalledWith(RULES[0]!.id, { rate: '0.0500' }),
    );
    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith(expect.objectContaining({ title: 'Rate saved' })),
    );

    await user.type(screen.getByLabelText('OST rate (%)'), '3.5');
    await user.click(screen.getByRole('button', { name: 'Save OST rate' }));
    await waitFor(() =>
      expect(createCommissionRule).toHaveBeenCalledWith(
        expect.objectContaining({
          targetType: 'role',
          targetId: ROSTER.positions[1]!.roleId,
          rate: '0.0350',
        }),
      ),
    );
  });

  it('sets a personal rate for the selected sellers', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    await screen.findByText('Ana Reyes');

    await user.click(screen.getByLabelText('Select Ana Reyes'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set rate' }));

    const dialog = await screen.findByRole('dialog', { name: 'Set personal rate' });
    const save = within(dialog).getByRole('button', { name: 'Save rate' });
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Rate (%)'), '101');
    expect(within(dialog).getByText('Use 0 to 100.')).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Rate (%)'));
    await user.type(within(dialog).getByLabelText('Rate (%)'), '4');
    await user.click(save);

    expect(notifyConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: '1 seller at 4.00%.' }),
    );
    await waitFor(() =>
      expect(bulkSetCommissionRate).toHaveBeenCalledWith({
        memberIds: [ANA],
        rate: '0.0400',
        effectiveFrom: new Date().toISOString().slice(0, 10),
      }),
    );
    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Rates saved', message: 'Saved for 1 seller.' }),
      ),
    );
    expect(screen.queryByText('1 selected')).toBeNull();
  });

  it('does not save when the confirmation is declined', async () => {
    const user = userEvent.setup();
    notifyConfirm.mockResolvedValue(false);
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    await screen.findByText('Ana Reyes');
    await user.click(screen.getByLabelText('Select Ana Reyes'));
    await user.click(screen.getByRole('button', { name: 'Set rate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set personal rate' });
    await user.type(within(dialog).getByLabelText('Rate (%)'), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }));
    await waitFor(() => expect(notifyConfirm).toHaveBeenCalled());
    expect(bulkSetCommissionRate).not.toHaveBeenCalled();
  });

  it('shows a spinner while saving and keeps the dialog open on error', async () => {
    const user = userEvent.setup();
    let fail!: (error: Error) => void;
    vi.mocked(bulkSetCommissionRate).mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    await screen.findByText('Ana Reyes');
    await user.click(screen.getByLabelText('Select Ana Reyes'));
    await user.click(screen.getByRole('button', { name: 'Set rate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set personal rate' });
    await user.type(within(dialog).getByLabelText('Rate (%)'), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }));

    expect(await within(dialog).findByText('Saving…')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByLabelText('Rate (%)')).toBeDisabled();

    fail(new Error('Only active sellers can receive a rate'));
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Rates not saved',
          message: 'Only active sellers can receive a rate',
        }),
      ),
    );
    expect(within(dialog).getByLabelText('Rate (%)')).toHaveValue('4');
    expect(within(dialog).getByRole('button', { name: 'Save rate' })).toBeEnabled();
  });

  it('switches tabs and reads the tab from the address', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER, route: '/admin?tab=rules' });
    expect(
      await screen.findByRole('tab', { name: 'All rules', selected: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'All rules' })).toBeVisible();
    await openTab(user, 'Sellers');
    expect(screen.getByRole('tab', { name: 'Sellers', selected: true })).toBeInTheDocument();
    expect(screen.getByLabelText('Select Ana Reyes')).toBeVisible();
  });

  it('shows a page skeleton on first load', () => {
    vi.mocked(getCommissionRoster).mockImplementationOnce(() => new Promise(() => undefined));
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    expect(screen.getByRole('status', { name: 'Loading commission settings' })).toBeInTheDocument();
  });

  it('confirms before disabling a rule and spins on that row only', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    vi.mocked(updateCommissionRule).mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve(RULES[0] as never))),
    );
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER, route: '/admin?tab=rules' });
    await screen.findByText('ANA REYES');
    await user.click(screen.getByRole('button', { name: 'Disable' }));
    expect(notifyConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Disable this rule?' }),
    );
    expect(await screen.findByText('Disabling…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeEnabled();
    finish();
    await waitFor(() =>
      expect(notifySuccess).toHaveBeenCalledWith(expect.objectContaining({ title: 'Rule disabled' })),
    );
  });

  it('selects every seller needing a rate in one step', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    await screen.findByText('Ana Reyes');
    await user.click(screen.getByRole('button', { name: 'Set their rate' }));

    expect(await screen.findByRole('dialog', { name: 'Set personal rate' })).toBeInTheDocument();
    expect(getCommissionRoster).toHaveBeenCalledWith({ sales: 'with', needsRate: true, limit: 100 });
    expect(screen.getByText(/Applies to 2 sellers/)).toBeInTheDocument();
  });

  it('filters sellers by sales activity', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    await screen.findByText('Ana Reyes');
    await user.selectOptions(screen.getByLabelText('Filter by sales'), 'needs');
    await waitFor(() =>
      expect(getCommissionRoster).toHaveBeenLastCalledWith({
        search: undefined,
        position: undefined,
        sales: 'with',
        needsRate: true,
        limit: 25,
        offset: 0,
      }),
    );
  });

  it('loads a rule into the editor as a percent', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    await screen.findByText('Ana Reyes');
    await openTab(user, 'All rules');
    const row = screen.getByText('ANA REYES').closest('tr')!;
    expect(row.textContent).toMatch(/On\/after 2026-09-01/);
    await user.click(within(row).getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('heading', { name: 'Edit rule' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Rate \(%\)/)).toHaveValue('5.00');
    expect(row).toHaveAttribute('data-editing');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(updateCommissionRule).toHaveBeenCalledWith(
        RULES[1]!.id,
        expect.objectContaining({ rate: '0.0500', effectiveUntil: '2026-12-31' }),
      ),
    );
  });

  it('shows rule history as changed fields only', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommissionSettingsPage />, { user: MANAGER });
    await screen.findByText('Ana Reyes');
    await openTab(user, 'All rules');
    await user.click(screen.getAllByRole('button', { name: 'History' })[0]!);

    const changes = await screen.findByRole('list', { name: 'Rule changes' });
    expect(within(changes).getByText('rate')).toBeInTheDocument();
    expect(within(changes).queryByText('isActive')).toBeNull();
    expect(within(changes).getByText('0.0400', { exact: false })).toBeInTheDocument();
    expect(within(changes).getByText('0.0500', { exact: false })).toBeInTheDocument();
  });
});
