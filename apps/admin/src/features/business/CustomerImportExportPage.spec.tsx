import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AfHomesPermission } from '@afhomes/contracts';

import { CustomerImportExportPage } from './CustomerImportExportPage';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { exportCustomers, getCustomerImportJobs } from './services';

vi.mock('./services', () => ({
  cancelCustomerImport: vi.fn(),
  confirmCustomerImport: vi.fn(),
  exportCustomers: vi.fn(),
  getCustomerImportJobs: vi.fn(),
  getCustomerImportTemplate: vi.fn(),
  parseCustomerImport: vi.fn(),
}));

vi.mock('../../lib/api/client', () => ({
  requestList: vi.fn().mockResolvedValue([]),
  setApiAccessTokenForTests: vi.fn(),
}));

const IMPORTER: SessionUser = {
  id: 'u-importer',
  name: 'Importer',
  email: 'importer@afhomes.test',
  roleId: 'r-admin',
  roleSlug: 'admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [
    {
      moduleKey: 'governance.customer_import',
      canView: true,
      canCreate: true,
      canUpdate: false,
      canDelete: false,
    } satisfies AfHomesPermission,
  ],
};

beforeEach(() => {
  vi.mocked(getCustomerImportJobs).mockResolvedValue([]);
  vi.mocked(exportCustomers).mockReset();
  vi.mocked(exportCustomers).mockResolvedValue({
    filename: 'customers.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    content: '',
  } as never);
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

describe('CustomerImportExportPage export filters', () => {
  it('sends the canonical category key, not the display label', async () => {
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    const category = await screen.findByLabelText('Category');
    fireEvent.change(category, { target: { value: 'ACTIVE_VIP' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export XLSX' }));
    expect(exportCustomers).toHaveBeenCalledWith(
      'xlsx',
      expect.objectContaining({ category: 'ACTIVE_VIP' }),
    );
    // The label text must never leak into the request payload.
    const [, params] = vi.mocked(exportCustomers).mock.calls[0] as [
      string,
      Record<string, string>,
    ];
    expect(Object.values(params)).not.toContain('Active VIP');
  });

  it('keeps the sheet URL input fluid on narrow viewports', async () => {
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    const input = await screen.findByPlaceholderText(/docs\.google\.com/);
    // No rigid 320px floor: full-width with a desktop cap instead.
    expect(input.style.minWidth).toBe('0px');
    expect(input.style.width).toBe('100%');
    expect(input.style.maxWidth).toBe('480px');
  });
});
