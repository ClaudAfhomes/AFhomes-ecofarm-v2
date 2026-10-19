import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
describe('imported purchase continuation', () => {
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
});
