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
    const user = userEvent.setup();
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    await user.click(screen.getByRole('tab', { name: 'Export' }));
    const category = await screen.findByLabelText('Category');
    fireEvent.change(category, { target: { value: 'ACTIVE_VIP' } });
    await user.click(screen.getByRole('button', { name: 'Export XLSX' }));
    expect(exportCustomers).toHaveBeenCalledWith(
      'xlsx',
      expect.objectContaining({ category: 'ACTIVE_VIP' }),
    );
    // The label text must never leak into the request payload.
    const [, params] = vi.mocked(exportCustomers).mock.calls[0] as [string, Record<string, string>];
    expect(Object.values(params)).not.toContain('Active VIP');
  });

  it('keeps the sheet URL input fluid on narrow viewports', async () => {
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    const input = await screen.findByPlaceholderText(/docs\.google\.com/);
    // Sizing comes from the stylesheet fluid class, never a rigid inline floor.
    expect(input.className).toMatch(/sheetInput/);
    expect(input.style.minWidth).toBe('');
  });
});

describe('CustomerImportExportPage workspace tabs', () => {
  it('switches between Import, Export, and Job history panels', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    expect(await screen.findByText('1. Download a template')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Export' }));
    expect(await screen.findByText('Export customers')).toBeInTheDocument();
    expect(screen.queryByText('1. Download a template')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Job history' }));
    expect(await screen.findByText('Import jobs')).toBeInTheDocument();
    expect(screen.queryByText('Export customers')).not.toBeInTheDocument();
  });

  it('offers button-styled file pickers backed by hidden labeled inputs', async () => {
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    expect(await screen.findByRole('button', { name: 'Choose Excel file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose CSV file' })).toBeInTheDocument();
    const excel = document.querySelector('input[accept=".xlsx"]');
    const csv = document.querySelector('input[accept=".csv"]');
    expect(excel?.getAttribute('aria-label')).toBe('Import Excel (.xlsx)');
    expect(csv?.getAttribute('aria-label')).toBe('Import CSV (UTF-8)');
  });

  it('hides the review and confirm steps until a preview exists', async () => {
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    expect(
      await screen.findByText('2. Upload and preview (nothing is written yet)'),
    ).toBeInTheDocument();
    expect(screen.queryByText('3. Review preview')).not.toBeInTheDocument();
    expect(screen.queryByText('4. Confirm import')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm Import/ })).not.toBeInTheDocument();
  });
});
