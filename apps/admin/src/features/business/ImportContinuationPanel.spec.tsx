import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerImportContinuation } from '@afhomes/contracts';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { ImportContinuationPanel } from './ImportContinuationPanel';
import { getImportContinuations } from './import-workflow-services';
vi.mock('./import-workflow-services', () => ({ getImportContinuations: vi.fn() }));
const user: SessionUser = {
  id: 'u',
  name: 'Admin',
  email: 'admin@example.test',
  roleId: 'r',
  roleSlug: 'super_admin',
  roleName: 'Super Admin',
  status: 'active',
  afHomesPermissions: [],
};
const baseContinuation: CustomerImportContinuation = {
  rowId: 'row',
  sourceId: 'source',
  customerId: 'customer',
  applicationId: 'application',
  reservationId: null,
  saleId: null,
  stage: 'finance',
  missingRequirements: [],
  conflicts: [],
  proposedFields: [],
  claimCount: 0,
  expectedSourceHash: 'a'.repeat(64),
  expectedTargetVersion: 'b'.repeat(64),
  expectedTeamVersion: 'c'.repeat(64),
  nextAction: null,
};
describe('imported purchase continuation', () => {
  it('shows accepted external payment history and its real destination without requesting re-verification', async () => {
    vi.mocked(getImportContinuations).mockResolvedValue([
      {
        rowId: 'row',
        sourceId: 'source',
        customerId: 'customer',
        applicationId: 'application',
        reservationId: 'reservation',
        saleId: null,
        stage: 'finance',
        missingRequirements: [],
        conflicts: [],
        proposedFields: [],
        claimCount: 1,
        expectedSourceHash: 'a'.repeat(64),
        expectedTargetVersion: 'b'.repeat(64),
        expectedTeamVersion: 'c'.repeat(64),
        externallyVerified: true,
        externalSummary: {
          stage: 'finance',
          paid: '100000.00',
          balance: '212000.00',
          total: '312000.00',
        },
        nextAction: { label: 'Continue collection', path: '/admin/finance/payments' },
      },
    ]);
    renderWithProviders(<ImportContinuationPanel customerId="customer" />, { user });
    expect(
      await screen.findByText(/Verified payments: 100000.00. Remaining balance: 212000.00/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/separate payment verification/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue collection' })).toHaveAttribute(
      'href',
      '/admin/finance/payments',
    );
  });
  it('shows the authoritative next destination and claim warning without recording money', async () => {
    vi.mocked(getImportContinuations).mockResolvedValue([
      {
        rowId: 'row',
        sourceId: 'source',
        customerId: 'customer',
        applicationId: null,
        reservationId: null,
        saleId: null,
        stage: 'application',
        missingRequirements: ['Review acknowledgement date'],
        conflicts: [],
        proposedFields: [],
        claimCount: 1,
        expectedSourceHash: 'a'.repeat(64),
        expectedTargetVersion: 'b'.repeat(64),
        expectedTeamVersion: 'c'.repeat(64),
        nextAction: {
          label: 'Complete application',
          path: '/admin/customers/applications/new?importRowId=row',
        },
      },
    ]);
    renderWithProviders(<ImportContinuationPanel customerId="customer" />, { user });
    expect(await screen.findByRole('link', { name: 'Complete application' })).toHaveAttribute(
      'href',
      '/admin/customers/applications/new?importRowId=row',
    );
    expect(screen.getByText(/separate payment verification/)).toBeInTheDocument();
    expect(screen.getByText('Review acknowledgement date')).toBeInTheDocument();
  });
  it('does not request import evidence for a customer-only viewer', () => {
    vi.mocked(getImportContinuations).mockClear();
    renderWithProviders(<ImportContinuationPanel customerId="customer" />, {
      user: { ...user, roleSlug: 'admin' },
    });
    expect(getImportContinuations).not.toHaveBeenCalled();
  });

  it('renders the imported purchases tab with stated and verified money separated', async () => {
    vi.mocked(getImportContinuations).mockResolvedValue([
      {
        ...baseContinuation,
        customerName: 'MARIA SANTOS',
        purchaseReference: 'WB-0001',
        purchaseStatement: {
          tier: 'GOLD',
          total: '312000',
          reservationFee: '5000',
        },
        externallyVerified: true,
        externalSummary: {
          stage: 'finance',
          paid: '100000.00',
          balance: '212000.00',
          total: '312000.00',
        },
        missingRequirements: [
          'Review acknowledgement date',
          'Complete and review the application, including actual acknowledgment date, consent and required holder fields.',
        ],
        conflicts: [
          {
            field: 'contract_date',
            message: 'Contract date differs from the existing reservation date.',
          },
        ],
        nextAction: {
          label: 'Review payments and continue collection',
          path: '/admin/finance/payments',
        },
      },
    ]);
    renderWithProviders(<ImportContinuationPanel variant="page" />, { user });
    expect(
      await screen.findByRole('heading', { name: 'Imported purchases' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('MARIA SANTOS')).toBeInTheDocument();
    expect(screen.getByText('WB-0001')).toBeInTheDocument();
    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.getByText('GOLD')).toBeInTheDocument();
    expect(screen.getByText('312,000')).toBeInTheDocument();
    expect(screen.getByText('5,000')).toBeInTheDocument();
    expect(screen.getByText('External payments accepted')).toBeInTheDocument();
    expect(screen.getByText('Paid ₱100,000.00')).toBeInTheDocument();
    expect(screen.getByText('Balance ₱212,000.00')).toBeInTheDocument();
    expect(screen.getByText('Review acknowledgement date')).toBeInTheDocument();
    expect(
      screen.getByText('Complete and review the application, including…'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/actual acknowledgment date/)).not.toBeInTheDocument();
    expect(screen.getByText(/Contract date differs from the existing…/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review payments' })).toHaveAttribute(
      'href',
      '/admin/finance/payments',
    );
  });

  it('combines finance review and verification into one short note', async () => {
    vi.mocked(getImportContinuations).mockResolvedValue([
      {
        ...baseContinuation,
        customerName: 'JUAN DELA CRUZ',
        purchaseReference: 'WB-0002',
        claimCount: 3,
      },
    ]);
    renderWithProviders(<ImportContinuationPanel variant="page" />, { user });
    expect(await screen.findByText('3 imported claims')).toBeInTheDocument();
    expect(screen.getByText('Finance review and verification required.')).toBeInTheDocument();
    expect(screen.queryByText('Separate verification required.')).not.toBeInTheDocument();
  });

  it('shows an explicit empty state in the imported purchases tab', async () => {
    vi.mocked(getImportContinuations).mockResolvedValue([]);
    renderWithProviders(<ImportContinuationPanel variant="page" />, { user });
    expect(await screen.findByText('No imported purchases')).toBeInTheDocument();
    expect(screen.getByText('Nothing waiting from the workbook.')).toBeInTheDocument();
  });

  it('offers a retry when the imported purchases tab cannot load', async () => {
    vi.mocked(getImportContinuations).mockRejectedValue(new Error('offline'));
    renderWithProviders(<ImportContinuationPanel variant="page" />, { user });
    expect(
      await screen.findByText('Imported purchases could not be loaded'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('walks imported purchases in 25-row pages', async () => {
    vi.mocked(getImportContinuations).mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => ({
        ...baseContinuation,
        rowId: `row-${index}`,
        customerName: `Customer ${index}`,
        purchaseReference: `WB-${index}`,
      })),
    );
    const browser = userEvent.setup();
    renderWithProviders(<ImportContinuationPanel variant="page" />, { user });
    await screen.findByText('Customer 0');
    await browser.click(screen.getByRole('button', { name: 'More' }));
    await waitFor(() =>
      expect(getImportContinuations).toHaveBeenLastCalledWith(undefined, 25),
    );
  });
});
