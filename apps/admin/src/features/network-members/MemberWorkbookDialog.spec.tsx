import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { MemberWorkbookDialog } from './MemberWorkbookDialog';
import {
  createMember,
  createOstMember,
  previewMemberWorkbook,
  getMemberWorkbookJobs,
  confirmMemberWorkbookRow,
} from './services';

vi.mock('./services', async (original) => ({
  ...(await original<typeof import('./services')>()),
  createMember: vi.fn(),
  createOstMember: vi.fn(),
  previewMemberWorkbook: vi.fn(),
  downloadMemberWorkbook: vi.fn(),
  getMemberWorkbookJobs: vi.fn(),
  confirmMemberWorkbookRow: vi.fn(),
}));
const id = '11111111-1111-4111-8111-111111111111';
const batchPassword = 'SyntheticBatch123!';
function enterBatchPassword() {
  fireEvent.change(screen.getByLabelText('Batch temporary password (shared for all CREATE rows)'), {
    target: { value: batchPassword },
  });
}
const fields = {
  first_name: 'Test',
  last_name: 'Seller',
  email: 'seller@example.invalid',
  mobile: '09123456789',
  position: 'vice_director',
  birth_date: '1990-01-01',
  sex: 'Male',
  civil_status: 'Single',
  address_line_1: 'One Street',
  province: 'Laguna',
  province_code: '0403400000',
  city: 'Calauan',
  city_code: '0403406000',
  barangay: 'Dayap',
  barangay_code: '0403406001',
  postal_code: '4012',
  aa_mode: 'auto',
  government_id_type: 'passport',
  government_id_number: 'P1234567',
  employer_name: 'Example',
  employer_address: 'Calauan',
  job_position: 'Seller',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createMember).mockResolvedValue({ id } as never);
});
async function upload() {
  fireEvent.change(screen.getByLabelText('Excel workbook (.xlsx)'), {
    target: {
      files: [
        new File(['synthetic'], 'members.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Validate and preview' }));
  await screen.findByText(/rows ·|Job .*complete/);
}
it('requires an explicit review checkbox and uses the existing IST API with a temporary password', async () => {
  vi.mocked(previewMemberWorkbook).mockResolvedValue({
    kind: 'IST',
    departmentId: id,
    rows: [{ rowNumber: 2, fields, errors: [] }],
  });
  const onCreated = vi.fn();
  renderWithProviders(<MemberWorkbookDialog onClose={vi.fn()} onCreated={onCreated} />);
  await upload();
  const button = screen.getByRole('button', { name: 'Create 1 IST accounts' });
  expect(button).toBeDisabled();
  expect(createMember).not.toHaveBeenCalled();
  // Batch password field exists and is required
  expect(
    screen.getByLabelText('Batch temporary password (shared for all CREATE rows)'),
  ).toBeInTheDocument();
  enterBatchPassword();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(button);
  await screen.findByText('Created; password change required.');
  expect(createMember).toHaveBeenCalledWith(
    expect.objectContaining({
      position: 'vice_director',
      temporaryPassword: batchPassword,
      referrerStaffId: null,
    }),
  );
  expect(createOstMember).not.toHaveBeenCalled();
  expect(onCreated).toHaveBeenCalledOnce();
  expect(button).toBeDisabled();
});
it.each(['IST', 'OST'] as const)(
  'confirms every %s company row with one chosen password in hierarchy order',
  async (kind) => {
    const ids = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
    const job = {
      id,
      kind,
      sourceHash: 'synthetic',
      createdAt: '2026-10-18',
      rows: [
        {
          id: ids[1]!,
          rowNumber: 2,
          decision: 'CREATE' as const,
          state: 'preview' as 'preview' | 'completed',
          errors: [],
          memberId: null,
          name: 'Synthetic SM',
          email: 'sm@example.invalid',
          mobile: '09123456789',
          aaNumber: null,
          head: 'Synthetic VD',
          position: 'sales_manager',
          details: {},
          lastError: null,
          attempts: 0,
        },
        {
          id: ids[0]!,
          rowNumber: 3,
          decision: 'CREATE' as const,
          state: 'preview' as 'preview' | 'completed',
          errors: [],
          memberId: null,
          name: 'Synthetic VD',
          email: 'vd@example.invalid',
          mobile: '09123456788',
          aaNumber: null,
          head: null,
          position: 'vice_director',
          details: {},
          lastError: null,
          attempts: 0,
        },
      ],
    };
    vi.mocked(previewMemberWorkbook).mockResolvedValue({
      kind,
      departmentId: id,
      jobId: id,
      rows: [{ rowNumber: 2, fields: { ...fields, source_layout: 'company-v2' }, errors: [] }],
    });
    vi.mocked(getMemberWorkbookJobs).mockImplementation(async () => [structuredClone(job)]);
    vi.mocked(confirmMemberWorkbookRow).mockImplementation(async (_job, _row) => {
      job.rows.find((r) => r.id === _row)!.state = 'completed';
      return [structuredClone(job)];
    });
    const changed = vi.fn();
    renderWithProviders(<MemberWorkbookDialog onClose={vi.fn()} onCreated={changed} />);
    fireEvent.change(screen.getByLabelText('Workbook type'), { target: { value: kind } });
    await upload();
    const button = screen.getByRole('button', { name: 'Confirm / resume reviewed import' });
    expect(button).toBeDisabled();
    // Batch password field exists
    expect(
      screen.getByLabelText('Batch temporary password (shared for all CREATE rows)'),
    ).toBeInTheDocument();
    // Without batch password, confirm shows error
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    await screen.findByText(/Enter a temporary password/);
    expect(changed).not.toHaveBeenCalled();
    enterBatchPassword();
    fireEvent.click(button);
    await waitFor(() => expect(confirmMemberWorkbookRow).toHaveBeenCalledTimes(2));
    expect(vi.mocked(confirmMemberWorkbookRow).mock.calls).toEqual([
      [id, ids[0], true, batchPassword],
      [id, ids[1], true, batchPassword],
    ]);
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  },
);
it('blocks creation when any row has a validation error', async () => {
  vi.mocked(previewMemberWorkbook).mockResolvedValue({
    kind: 'IST',
    departmentId: id,
    rows: [{ rowNumber: 2, fields, errors: ['Wrong head'] }],
  });
  renderWithProviders(<MemberWorkbookDialog onClose={vi.fn()} onCreated={vi.fn()} />);
  await upload();
  expect(await screen.findByText('Wrong head')).toBeVisible();
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Create 1 IST accounts' })).toBeDisabled();
  expect(createMember).not.toHaveBeenCalled();
});
it('refreshes members after an ambiguous first-row failure without retrying it', async () => {
  vi.mocked(previewMemberWorkbook).mockResolvedValue({
    kind: 'IST',
    departmentId: id,
    rows: [{ rowNumber: 2, fields, errors: [] }],
  });
  vi.mocked(createMember).mockRejectedValueOnce(new Error('Response lost after submission'));
  const changed = vi.fn();
  renderWithProviders(<MemberWorkbookDialog onClose={vi.fn()} onCreated={changed} />);
  await upload();
  // Batch password field exists
  expect(
    screen.getByLabelText('Batch temporary password (shared for all CREATE rows)'),
  ).toBeInTheDocument();
  enterBatchPassword();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Create 1 IST accounts' }));
  await screen.findByRole('alert');
  expect(createMember).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Create 1 IST accounts' })).toBeDisabled();
});
it('retains successful credentials and stops after a failed row without attempting later rows or retrying', async () => {
  vi.mocked(previewMemberWorkbook).mockResolvedValue({
    kind: 'IST',
    departmentId: id,
    rows: [2, 3, 4].map((rowNumber) => ({
      rowNumber,
      fields: { ...fields, email: `seller${rowNumber}@example.invalid` },
      errors: [],
    })),
  });
  vi.mocked(createMember)
    .mockResolvedValueOnce({ id } as never)
    .mockRejectedValueOnce(new Error('Request timed out'));
  const changed = vi.fn();
  renderWithProviders(<MemberWorkbookDialog onClose={vi.fn()} onCreated={changed} />);
  await upload();
  // Batch password field exists
  expect(
    screen.getByLabelText('Batch temporary password (shared for all CREATE rows)'),
  ).toBeInTheDocument();
  enterBatchPassword();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Create 3 IST accounts' }));
  await screen.findByRole('alert');
  expect(createMember).toHaveBeenCalledTimes(2);
  expect(vi.mocked(createMember).mock.calls.map(([input]) => input.temporaryPassword)).toEqual([
    batchPassword,
    batchPassword,
  ]);
  expect(screen.getByText('Created; password change required.')).toBeVisible();
  expect(screen.getByText(/Stopped\. Verify/)).toBeVisible();
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: 'Create 3 IST accounts' })).toBeDisabled();
});
it('sends OST completion to its own creation API and preserves the preview request key', async () => {
  vi.mocked(previewMemberWorkbook).mockResolvedValue({
    kind: 'OST',
    departmentId: id,
    rows: [
      {
        rowNumber: 2,
        errors: [],
        fields: {
          ...fields,
          position: 'ost',
          head_staff_id: id,
          head_member: 'sm@example.invalid',
          request_id: id,
          starts_on: '2026-10-17',
          date_applied: '2026-10-17',
          program_category: 'non_vip',
          applicant_signature: 'received',
          referrer_signature: 'received',
          applicant_signed_on: '2026-10-17',
          referrer_signed_on: '2026-10-17',
        },
      },
    ],
  });
  vi.mocked(createOstMember).mockResolvedValue({
    applicationId: id,
    memberId: id,
    status: 'approved',
  });
  renderWithProviders(<MemberWorkbookDialog onClose={vi.fn()} onCreated={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Workbook type'), { target: { value: 'OST' } });
  await upload();
  // Batch password field exists
  expect(
    screen.getByLabelText('Batch temporary password (shared for all CREATE rows)'),
  ).toBeInTheDocument();
  enterBatchPassword();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Create 1 OST accounts' }));
  await screen.findByText('Created; password change required.');
  expect(createOstMember).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: id,
      mode: 'complete',
      sponsorStaffId: id,
      expiresOn: '2027-10-17',
      temporaryPassword: batchPassword,
    }),
  );
  expect(createMember).not.toHaveBeenCalled();
});
