import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_SUPER_ADMIN } from '@jad/mock';

import { resetStaffStore } from '../../../mock/staffMockStore';
import { installMockApi, renderWithProviders } from '../../../test/utils';
import { RolesPage } from './RolesPage';

describe('RolesPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetStaffStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders page header and system roles', async () => {
    renderWithProviders(<RolesPage />, { user: MOCK_SUPER_ADMIN });
    expect(await screen.findByText('Roles')).toBeInTheDocument();
    expect(screen.getByText(/changes are audited/i)).toBeInTheDocument();
    expect(await screen.findByText('Super Admin')).toBeInTheDocument();
    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.getByText('Merchant')).toBeInTheDocument();
  });

  it('shows member and module counts with footer', async () => {
    renderWithProviders(<RolesPage />, { user: MOCK_SUPER_ADMIN });
    await screen.findByText('Super Admin');
    expect(screen.getAllByText('System').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/4 roles page 1 of 1/)).toBeInTheDocument();
  });

  it('searches roles by name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesPage />, { user: MOCK_SUPER_ADMIN });
    await screen.findByText('Super Admin');

    await user.type(screen.getByLabelText('Search roles'), 'merch');
    expect(screen.getByText('Merchant')).toBeInTheDocument();
    expect(screen.queryByText('Finance')).not.toBeInTheDocument();
  });

  it('filters custom roles (empty in seed)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesPage />, { user: MOCK_SUPER_ADMIN });
    await screen.findByText('Super Admin');

    await user.selectOptions(screen.getByLabelText('Filter by type'), 'CUSTOM');
    expect(screen.getByText('No roles found')).toBeInTheDocument();
  });

  it('opens the create dialog from the header action', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RolesPage />, { user: MOCK_SUPER_ADMIN });
    await screen.findByText('Super Admin');
    await user.click(screen.getByText('New Role'));
    expect(await screen.findByRole('heading', { name: 'Create Role' })).toBeInTheDocument();
  });

  it('has clickable rows', async () => {
    renderWithProviders(<RolesPage />, { user: MOCK_SUPER_ADMIN });
    await screen.findByText('Super Admin');
    const rows = screen.getAllByRole('row');
    const dataRows = rows.filter((row) => row.getAttribute('aria-label')?.startsWith('View role'));
    expect(dataRows.length).toBe(4);
    expect(dataRows[0]).toHaveAttribute('tabindex', '0');
  });
});
