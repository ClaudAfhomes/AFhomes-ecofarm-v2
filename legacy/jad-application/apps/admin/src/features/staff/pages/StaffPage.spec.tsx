import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_SUPER_ADMIN } from '@jad/mock';

import { resetStaffStore } from '../../../mock/staffMockStore';
import { installMockApi, renderWithProviders } from '../../../test/utils';
import { StaffPage } from './StaffPage';

describe('StaffPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetStaffStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders page header and roster', async () => {
    renderWithProviders(<StaffPage />, { user: MOCK_SUPER_ADMIN });
    expect(await screen.findByText('Staff')).toBeInTheDocument();
    expect(screen.getByText(/role changes are audited/i)).toBeInTheDocument();
    expect(await screen.findByText('Saul Super')).toBeInTheDocument();
    expect(screen.getByText('Ada Admin')).toBeInTheDocument();
    expect(screen.getByText('Fina Finance')).toBeInTheDocument();
    expect(screen.getByText('Maya Merchant')).toBeInTheDocument();
  });

  it('opens the create dialog from the header action', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StaffPage />, { user: MOCK_SUPER_ADMIN });
    await screen.findByText('Saul Super');
    await user.click(screen.getByText('New Staff'));
    expect(await screen.findByText('Create Staff Member')).toBeInTheDocument();
  });

  it('shows role and status chips with footer count', async () => {
    renderWithProviders(<StaffPage />, { user: MOCK_SUPER_ADMIN });
    await screen.findByText('Saul Super');
    // Role/status labels also appear as filter options - assert chip + option.
    expect(screen.getAllByText('Super Admin').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Admin').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Disabled').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/7 staff members page 1 of 1/)).toBeInTheDocument();
  });

  it('filters by role', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StaffPage />, { user: MOCK_SUPER_ADMIN });
    await screen.findByText('Saul Super');

    await user.selectOptions(screen.getByLabelText('Filter by role'), 'finance');
    expect(screen.getByText('Fina Finance')).toBeInTheDocument();
    expect(screen.getByText('Leo Tan')).toBeInTheDocument();
    expect(screen.queryByText('Saul Super')).not.toBeInTheDocument();
    expect(screen.getByText(/2 staff members page 1 of 1/)).toBeInTheDocument();
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StaffPage />, { user: MOCK_SUPER_ADMIN });
    await screen.findByText('Saul Super');

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'DISABLED');
    expect(screen.getByText('Leo Tan')).toBeInTheDocument();
    expect(screen.queryByText('Saul Super')).not.toBeInTheDocument();
    expect(screen.getByText(/1 staff member page 1 of 1/)).toBeInTheDocument();
  });

  it('searches by name or email', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StaffPage />, { user: MOCK_SUPER_ADMIN });
    await screen.findByText('Saul Super');

    await user.type(screen.getByLabelText('Search staff'), 'maya');
    expect(screen.getByText('Maya Merchant')).toBeInTheDocument();
    expect(screen.queryByText('Saul Super')).not.toBeInTheDocument();
  });

  it('clears all filters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<StaffPage />, { user: MOCK_SUPER_ADMIN });
    await screen.findByText('Saul Super');

    await user.selectOptions(screen.getByLabelText('Filter by role'), 'merchant');
    expect(screen.queryByText('Saul Super')).not.toBeInTheDocument();
    await user.click(screen.getByText('Clear'));
    expect(screen.getByText('Saul Super')).toBeInTheDocument();
  });

  it('has clickable rows', async () => {
    renderWithProviders(<StaffPage />, { user: MOCK_SUPER_ADMIN });
    await screen.findByText('Saul Super');
    const rows = screen.getAllByRole('row');
    const dataRows = rows.filter((row) => row.getAttribute('aria-label')?.startsWith('View'));
    expect(dataRows.length).toBe(7);
    expect(dataRows[0]).toHaveAttribute('tabindex', '0');
  });
});
