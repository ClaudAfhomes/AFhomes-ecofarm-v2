import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { MemberWorkbookDialog } from './MemberWorkbookDialog';
import { createMember, createOstMember, previewMemberWorkbook } from './services';

vi.mock('./services', async (original) => ({
  ...(await original<typeof import('./services')>()),
  createMember: vi.fn(),
  createOstMember: vi.fn(),
  previewMemberWorkbook: vi.fn(),
  downloadMemberWorkbook: vi.fn(),
}));
const id = '11111111-1111-4111-8111-111111111111';
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
  await screen.findByText(/rows ·/);
}
it('requires an explicit review checkbox and uses the existing IST API with an individual temporary password', async () => {
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
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(button);
  await screen.findByText('Created; password change required.');
  expect(createMember).toHaveBeenCalledWith(
    expect.objectContaining({
      position: 'vice_director',
      temporaryPassword: expect.stringMatching(/^Aa1!/),
      referrerStaffId: null,
    }),
  );
  expect(createOstMember).not.toHaveBeenCalled();
  expect(onCreated).toHaveBeenCalledOnce();
  expect(button).toBeDisabled();
});
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
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Create 3 IST accounts' }));
  await screen.findByRole('alert');
  expect(createMember).toHaveBeenCalledTimes(2);
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
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Create 1 OST accounts' }));
  await screen.findByText('Created; password change required.');
  expect(createOstMember).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: id,
      mode: 'complete',
      sponsorStaffId: id,
      expiresOn: '2027-10-17',
    }),
  );
  expect(createMember).not.toHaveBeenCalled();
});
