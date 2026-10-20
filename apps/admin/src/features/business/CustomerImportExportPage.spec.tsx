import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AfHomesPermission } from '@afhomes/contracts';
import { customerImportParseResponseSchema } from '@afhomes/contracts';

import { CustomerImportExportPage } from './CustomerImportExportPage';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import {
  exportCustomers,
  getCustomerImportJobs,
  parseCustomerImport,
  confirmCustomerImport,
  getCustomerImportJob,
} from './services';

vi.mock('./services', () => ({
  cancelCustomerImport: vi.fn(),
  confirmCustomerImport: vi.fn(),
  exportCustomers: vi.fn(),
  getCustomerImportJobs: vi.fn(),
  getCustomerImportJob: vi.fn(),
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
  vi.mocked(parseCustomerImport).mockReset();
  vi.mocked(confirmCustomerImport).mockReset();
  vi.mocked(getCustomerImportJob).mockReset();
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

it('requires an explicit external-history selection and carries it into the reviewed upload', async () => {
  const user = userEvent.setup();
  vi.mocked(parseCustomerImport).mockResolvedValue(previewFixture());
  renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
  await user.click(screen.getByRole('checkbox', { name: /already verified outside/ }));
  await user.upload(
    screen.getByLabelText('Import Excel (.xlsx or .xlsm)'),
    new File(['synthetic'], 'verified.xlsx'),
  );
  await waitFor(() =>
    expect(parseCustomerImport).toHaveBeenCalledWith(
      expect.objectContaining({
        externalVerificationReason: expect.stringContaining('verified outside the system'),
      }),
    ),
  );
  expect(screen.getByRole('checkbox', { name: /already verified outside/ })).toBeDisabled();
});

const previewFixture = (total = 1) =>
  customerImportParseResponseSchema.parse({
    job: {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      sourceType: 'excel',
      sourceName: 'synthetic.xlsm',
      googleSheetId: null,
      status: 'ready',
      totalRows: total,
      validRows: total,
      invalidRows: 0,
      insertedRows: 0,
      updatedRows: 0,
      skippedRows: 0,
      createdAt: '2026-10-16',
      validatedAt: '2026-10-16',
      committedAt: null,
      cancelledAt: null,
    },
    pageSize: 10,
    rows: Array.from({ length: Math.min(total, 10) }, (_, i) => ({
      id: 'bbbbbbbb-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
      rowNumber: i + 2,
      fields: {
        workbook_format: 'company_v1',
        first_name: 'Synthetic',
        last_name: 'Customer',
        email: `synthetic${i}@example.invalid`,
        mobile: '09123456789',
        tin: 'SYNTHETIC-PRIVATE-TIN',
      },
      normalized: { category: 'PENDING' },
      validation: 'warning',
      errors: [],
      warnings: [],
      action: 'CREATE',
      customerId: null,
      membershipId: null,
    })),
  });

describe('company workbook review', () => {
  it('expands every genealogy conflict and shows the independent TIN cell error', async () => {
    const preview = previewFixture();
    preview.rows[0]!.errors = [
      { field: 'vd_name', message: 'Synthetic VD lineage conflict' },
      { field: 'recommender_name', message: 'Separate registered VD tree' },
      { field: 'tin', message: 'TIN has 6 digits; enter the complete 9-digit TIN' },
    ];
    vi.mocked(parseCustomerImport).mockResolvedValue(preview);
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Import Excel (.xlsx or .xlsm)'),
      new File(['synthetic'], 'synthetic.xlsx'),
    );
    await user.click(await screen.findByText('Show 1 more'));
    expect(screen.getByText(/Related!E2.*Separate registered VD tree/)).toBeVisible();
    expect(screen.getByText(/Primary!T2.*TIN has 6 digits/)).toBeVisible();
    expect(screen.queryByText('SYNTHETIC-PRIVATE-TIN')).not.toBeInTheDocument();
  });
  it('accepts XLSM, displays mapped fields without TIN and gates confirmation by update permission', async () => {
    const user = userEvent.setup();
    const preview = previewFixture();
    vi.mocked(parseCustomerImport).mockResolvedValue(preview);
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    await user.upload(
      screen.getByLabelText('Import Excel (.xlsx or .xlsm)'),
      new File(['synthetic'], 'synthetic.xlsm'),
    );
    expect(await screen.findByText('Review mapped fields')).toBeInTheDocument();
    expect(screen.getByText('Primary!U2 (MOBILE NO.)')).toBeInTheDocument();
    expect(screen.queryByText('SYNTHETIC-PRIVATE-TIN')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Import (1 rows)' })).toBeDisabled();
  });
  it('loads later preview pages through the existing job API', async () => {
    const user = userEvent.setup();
    const preview = previewFixture(11);
    vi.mocked(parseCustomerImport).mockResolvedValue(preview);
    vi.mocked(getCustomerImportJob).mockResolvedValue({
      job: preview.job,
      rows: [
        {
          ...preview.rows[0]!,
          rowNumber: 12,
          fields: { first_name: 'Last', last_name: 'Customer', email: 'last@example.invalid' },
        },
      ],
    });
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    await user.upload(
      screen.getByLabelText('Import Excel (.xlsx or .xlsm)'),
      new File(['synthetic'], 'synthetic.xlsm'),
    );
    await user.click(await screen.findByRole('button', { name: 'Next preview page' }));
    expect(await screen.findByText(/Last Customer/)).toBeInTheDocument();
    expect(getCustomerImportJob).toHaveBeenCalledWith(preview.job.id, 10, 10);
  });
  it('confirms authorized imports through bounded requests until the job completes', async () => {
    const user = userEvent.setup();
    const preview = previewFixture();
    vi.mocked(parseCustomerImport).mockResolvedValue(preview);
    vi.mocked(confirmCustomerImport)
      .mockResolvedValueOnce({
        job: { ...preview.job, status: 'committing' },
        committed: 0,
        failed: 0,
        rowResults: [],
      })
      .mockResolvedValueOnce({
        job: { ...preview.job, status: 'completed', insertedRows: 1 },
        committed: 1,
        failed: 0,
        rowResults: [],
      });
    renderWithProviders(<CustomerImportExportPage />, {
      user: {
        ...IMPORTER,
        afHomesPermissions: IMPORTER.afHomesPermissions.map((p) => ({ ...p, canUpdate: true })),
      },
    });
    await user.upload(
      screen.getByLabelText('Import Excel (.xlsx or .xlsm)'),
      new File(['synthetic'], 'synthetic.xlsm'),
    );
    await user.click(await screen.findByRole('button', { name: 'Confirm Import (1 rows)' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(confirmCustomerImport).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Import committed: 1 written/)).toBeInTheDocument();
  });
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
  it('presents one download card per template format with guidance', async () => {
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    expect(await screen.findByText('1. Download a template')).toBeInTheDocument();
    expect(screen.getByText('Excel workbook (.xlsx)')).toBeInTheDocument();
    expect(screen.getByText('Plain text (.csv)')).toBeInTheDocument();
    expect(screen.queryByText('5 sheets · color headers · no data')).not.toBeInTheDocument();
    expect(screen.queryByText(/columns · .* · no data/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download XLSX template' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV template' })).toBeInTheDocument();
  });

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
    const excelBtn = await screen.findByRole('button', { name: 'Choose Excel file' });
    const csvBtn = screen.getByRole('button', { name: 'Choose CSV file' });
    // One shared row holds both pickers side by side.
    expect(excelBtn.parentElement?.parentElement).toBe(csvBtn.parentElement?.parentElement);
    const excel = document.querySelector('input[accept*=".xlsm"]');
    const csv = document.querySelector('input[accept=".csv"]');
    expect(excel?.getAttribute('aria-label')).toBe('Import Excel (.xlsx or .xlsm)');
    expect(csv?.getAttribute('aria-label')).toBe('Import CSV (UTF-8)');
  });

  it('hides the review and confirm steps until a preview exists', async () => {
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    expect(await screen.findByText('2. Upload and preview')).toBeInTheDocument();
    expect(screen.queryByText('3. Review preview')).not.toBeInTheDocument();
    expect(screen.queryByText('4. Confirm import')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm Import/ })).not.toBeInTheDocument();
  });
});

describe('CustomerImportExportPage job history', () => {
  const job = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'aaaaaaaa-0000-4000-8000-000000000009',
    jobNumber: 'AF-IMP-000009',
    sourceType: 'excel',
    sourceName: 'members-2026-09.xlsx',
    googleSheetId: null,
    status: 'completed',
    totalRows: 500,
    validRows: 480,
    invalidRows: 20,
    insertedRows: 460,
    updatedRows: 12,
    skippedRows: 8,
    createdAt: '2026-10-16T09:30:00.000Z',
    validatedAt: '2026-10-16T09:31:00.000Z',
    committedAt: '2026-10-16T09:32:00.000Z',
    failedAt: null,
    cancelledAt: null,
    failedRows: 20,
    ...over,
  });

  it('sums the headline figures from the jobs on screen and flags the broken rows', async () => {
    const user = userEvent.setup();
    vi.mocked(getCustomerImportJobs).mockResolvedValue([
      job(),
      job({
        id: 'aaaaaaaa-0000-4000-8000-000000000010',
        jobNumber: 'AF-IMP-000010',
        sourceName: 'members-2026-10.xlsx',
        insertedRows: 90,
        updatedRows: 0,
        skippedRows: 2,
        failedRows: 0,
      }),
    ] as never);
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    await user.click(screen.getByRole('tab', { name: 'Job history' }));
    await screen.findByText('Import jobs');

    // Every headline figure is summed from the rows, never typed in: 2 jobs,
    // 472 + 90 rows written, and 20 + 0 rows needing attention.
    expect(screen.getByLabelText('Import job summary')).toBeInTheDocument();
    const figure = (label: string) => screen.getByText(label).closest('div');
    expect(figure('Jobs')).toHaveTextContent('2');
    expect(figure('Rows written')).toHaveTextContent('562');
    expect(figure('Needs attention')).toHaveTextContent('20');

    // Only a non-zero failure count is allowed to take colour. The first job has
    // 20 broken rows and the second has none, so the rule is per job.
    expect(figure('Needs attention')).toHaveAttribute('data-alert', 'true');
    const failedCells = screen.getAllByText('Failed').map((dt) => dt.closest('div'));
    expect(failedCells).toHaveLength(2);
    expect(failedCells[0]).toHaveAttribute('data-alert', 'true');
    expect(failedCells[1]).not.toHaveAttribute('data-alert');

    // Both jobs are identifiable by file and reference, with no middot joining them.
    expect(screen.getByText('members-2026-09.xlsx')).toBeInTheDocument();
    expect(screen.getByText('members-2026-10.xlsx')).toBeInTheDocument();
    expect(screen.getByText('AF-IMP-000010')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it('shows a clean summary when no row failed, and no colour on a zero', async () => {
    const user = userEvent.setup();
    vi.mocked(getCustomerImportJobs).mockResolvedValue([
      job({ insertedRows: 500, updatedRows: 0, skippedRows: 0, failedRows: 0 }),
    ] as never);
    renderWithProviders(<CustomerImportExportPage />, { user: IMPORTER });
    await user.click(screen.getByRole('tab', { name: 'Job history' }));
    await screen.findByText('Import jobs');
    // A red zero is a false alarm, so the alert is only ever set above zero.
    expect(screen.getByText('Needs attention').closest('div')).not.toHaveAttribute('data-alert');
    expect(screen.getByText('Failed').closest('div')).not.toHaveAttribute('data-alert');
  });
});
