import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { appendStaffAudit, resetStaffStore } from '../../../mock/staffMockStore';
import { AuditPage } from './AuditPage';

describe('AuditPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetStaffStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
    resetStaffStore();
  });

  it('renders page header', async () => {
    renderWithProviders(<AuditPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Audit Logs')).toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it('renders combined table with audit and adjustment data', async () => {
    renderWithProviders(<AuditPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('REGISTRATION_APPROVED')).toBeInTheDocument();
    expect(screen.getByText('SALE_APPROVED')).toBeInTheDocument();
    expect(screen.getAllByText(/Financial Adjustment/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Maria Santos/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Pedro Reyes/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows total record count in footer', async () => {
    renderWithProviders(<AuditPage />, { user: MOCK_ADMIN });
    await screen.findByText('REGISTRATION_APPROVED');
    expect(screen.getByText(/15 records page 1 of 2/)).toBeInTheDocument();
  });

  it('filters by record type', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditPage />, { user: MOCK_ADMIN });
    await screen.findByText('REGISTRATION_APPROVED');

    const filter = screen.getByLabelText('Filter by record type');
    await user.selectOptions(filter, 'ADJUSTMENT');
    expect(screen.queryByText('REGISTRATION_APPROVED')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Financial Adjustment/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/3 records page 1 of 1/)).toBeInTheDocument();

    await user.selectOptions(filter, 'AUDIT');
    expect(screen.queryByText(/Financial Adjustment/)).not.toBeInTheDocument();
    expect(screen.getByText('REGISTRATION_APPROVED')).toBeInTheDocument();
    expect(screen.getByText(/12 records page 1 of 2/)).toBeInTheDocument();

    await user.selectOptions(filter, 'ALL');
    expect(screen.getByText('REGISTRATION_APPROVED')).toBeInTheDocument();
    expect(screen.getAllByText(/Financial Adjustment/).length).toBeGreaterThanOrEqual(1);
  });

  it('filters by actor role', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditPage />, { user: MOCK_ADMIN });
    await screen.findByText('REGISTRATION_APPROVED');

    const roleFilter = screen.getByLabelText('Filter by actor role');
    await user.selectOptions(roleFilter, 'SYSTEM');
    expect(screen.queryByText('REGISTRATION_APPROVED')).not.toBeInTheDocument();
    expect(screen.getByText('SALE_RESUBMISSION_EXCEEDED')).toBeInTheDocument();
  });

  it('filters by target type', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditPage />, { user: MOCK_ADMIN });
    await screen.findByText('REGISTRATION_APPROVED');

    const targetFilter = screen.getByLabelText('Filter by target type');
    await user.selectOptions(targetFilter, 'Registration');
    expect(screen.getByText('REGISTRATION_APPROVED')).toBeInTheDocument();
    expect(screen.queryByText('SALE_APPROVED')).not.toBeInTheDocument();
  });

  it('searches across summary, detail, and actor', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditPage />, { user: MOCK_ADMIN });
    await screen.findByText('REGISTRATION_APPROVED');

    const search = screen.getByLabelText('Search audit logs');
    await user.type(search, 'Pedro');
    expect(screen.getByText('PAYOUT_CONFIRMED')).toBeInTheDocument();
    expect(screen.getByText('WITHDRAWAL_COMPLETED')).toBeInTheDocument();
    expect(screen.queryByText('CONFIG_UPDATED')).not.toBeInTheDocument();
  });

  it('clears all filters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditPage />, { user: MOCK_ADMIN });
    await screen.findByText('REGISTRATION_APPROVED');

    await user.selectOptions(screen.getByLabelText('Filter by record type'), 'ADJUSTMENT');
    expect(screen.queryByText('REGISTRATION_APPROVED')).not.toBeInTheDocument();

    await user.click(screen.getByText('Clear'));
    expect(screen.getByText('REGISTRATION_APPROVED')).toBeInTheDocument();
  });

  it('includes staff governance entries from the audit trail', async () => {
    appendStaffAudit({
      action: 'STAFF_ROLE_ASSIGNED',
      actor: 'Saul Super',
      actorRole: 'SUPER_ADMIN',
      targetType: 'Staff',
      targetId: 'stf-002',
      targetName: 'Ada Admin',
      detail: 'Changed role from Admin to Finance',
    });
    renderWithProviders(<AuditPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('STAFF_ROLE_ASSIGNED')).toBeInTheDocument();
    // 'Ada Admin' also appears as actor on retconned audit rows.
    expect(screen.getAllByText('Ada Admin').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/16 records page 1 of 2/)).toBeInTheDocument();
  });

  it('has clickable rows that navigate', async () => {
    renderWithProviders(<AuditPage />, { user: MOCK_ADMIN });
    await screen.findByText('REGISTRATION_APPROVED');
    const rows = screen.getAllByRole('row');
    const dataRows = rows.filter((row) => row.getAttribute('aria-label')?.startsWith('View'));
    expect(dataRows.length).toBeGreaterThanOrEqual(1);
    expect(dataRows[0]).toHaveAttribute('tabindex', '0');
  });
});
