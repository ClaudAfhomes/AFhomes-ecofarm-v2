import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { memberSchema } from '@afhomes/contracts';
import { renderWithProviders } from '../../test/utils';
import { ApiError } from '../../lib/api/errors';
import { TransferToIstDialog } from './TransferToIstDialog';
import { getMemberUplines, transferMember, type MemberUpline } from './services';
import { getAccreditation } from '../ost/services';

vi.mock('./services', async (original) => ({
  ...(await original<typeof import('./services')>()),
  getMemberUplines: vi.fn(),
  transferMember: vi.fn(),
}));
vi.mock('../ost/services', () => ({ getAccreditation: vi.fn() }));

const UUID = /^[0-9a-f-]{36}$/;
const member = memberSchema.parse({
  ...Object.fromEntries(Object.keys(memberSchema.shape).map((key) => [key, null])),
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'SYNTHETIC OST',
  email: 'ost@example.invalid',
  position: 'ost',
  positionLabel: 'OST',
  status: 'active',
  aaNumber: 'AAO20010001',
  createdAt: '2020-01-01',
  referrerName: 'SM ONE',
  referrerStaffId: '55555555-5555-4555-8555-555555555555',
  detailAuthorized: true,
});
const records = (displayStatus: 'expired' | 'active') => ({
  registration: null,
  currentApplicant: null,
  renewals: [],
  terms: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      starts_on: '2020-01-01',
      expires_on: '2021-01-01',
      displayStatus,
      approved_at: '2020-01-01',
    },
  ],
});
const SSM: MemberUpline = {
  id: '22222222-2222-4222-8222-222222222222',
  fullName: 'SSM ONE',
  employeeNumber: null,
  positionLabel: 'Senior Sales Manager',
};
const VD: MemberUpline = {
  id: '33333333-3333-4333-8333-333333333333',
  fullName: 'VD ONE',
  employeeNumber: null,
  positionLabel: 'Sales Vice Director',
};
const REASON = 'Returns to the selling hierarchy';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAccreditation).mockResolvedValue(records('expired'));
  vi.mocked(getMemberUplines).mockImplementation(async (position) =>
    position === 'sales_manager' ? [SSM] : position === 'senior_sales_manager' ? [VD] : [],
  );
  vi.mocked(transferMember).mockResolvedValue(member);
});

function show() {
  const onTransferred = vi.fn();
  renderWithProviders(
    <TransferToIstDialog member={member} onClose={vi.fn()} onTransferred={onTransferred} />,
  );
  return onTransferred;
}

async function pickPosition(value: string) {
  const position = await screen.findByLabelText('Position');
  await waitFor(() => expect(position).toBeEnabled());
  fireEvent.change(position, { target: { value } });
}

it('blocks conversion while the OST accreditation is active', async () => {
  vi.mocked(getAccreditation).mockResolvedValue(records('active'));
  show();
  expect(
    await screen.findByText(
      'OST accreditation must expire before a transfer to IST can be approved.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Position')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Transfer to IST' })).toBeDisabled();
  expect(transferMember).not.toHaveBeenCalled();
});

it('requires the immediate SSM and sends the chosen position with a stable request id', async () => {
  const onTransferred = show();
  await pickPosition('sales_manager');
  const head = await screen.findByLabelText('Senior Sales Manager');
  await waitFor(() => expect(head).toBeEnabled());
  expect(getMemberUplines).toHaveBeenCalledWith('sales_manager');
  const submit = screen.getByRole('button', { name: 'Transfer to IST' });
  const reason = screen.getByLabelText(/^Reason for transfer/);
  fireEvent.change(reason, { target: { value: 'no' } });
  expect(submit).toBeDisabled();
  fireEvent.change(reason, { target: { value: REASON } });
  expect(submit).toBeDisabled();
  fireEvent.change(head, { target: { value: SSM.id } });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  await waitFor(() => expect(onTransferred).toHaveBeenCalledOnce());
  expect(transferMember).toHaveBeenCalledWith(member.id, {
    direction: 'OST_TO_IST',
    requestId: expect.stringMatching(UUID),
    reason: REASON,
    targetPosition: 'sales_manager',
    headStaffId: SSM.id,
  });
});

it('requires an eligible Vice Director for a Senior Sales Manager', async () => {
  show();
  await pickPosition('senior_sales_manager');
  const head = await screen.findByLabelText('Sales Vice Director');
  await waitFor(() => expect(head).toBeEnabled());
  expect(getMemberUplines).toHaveBeenCalledWith('senior_sales_manager');
  expect(await screen.findByRole('option', { name: 'VD ONE' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^Reason for transfer/), { target: { value: REASON } });
  expect(screen.getByRole('button', { name: 'Transfer to IST' })).toBeDisabled();
  fireEvent.change(head, { target: { value: VD.id } });
  expect(screen.getByRole('button', { name: 'Transfer to IST' })).toBeEnabled();
});

it('gives a Vice Director no head and sends a null head', async () => {
  const onTransferred = show();
  await pickPosition('vice_director');
  expect(screen.queryByLabelText('Sales Vice Director')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Senior Sales Manager')).not.toBeInTheDocument();
  expect(getMemberUplines).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/^Reason for transfer/), { target: { value: REASON } });
  fireEvent.click(screen.getByRole('button', { name: 'Transfer to IST' }));
  await waitFor(() => expect(onTransferred).toHaveBeenCalledOnce());
  expect(transferMember).toHaveBeenCalledWith(
    member.id,
    expect.objectContaining({ targetPosition: 'vice_director', headStaffId: null }),
  );
});

it('stays unavailable when no eligible head exists', async () => {
  vi.mocked(getMemberUplines).mockResolvedValue([]);
  show();
  await pickPosition('sales_manager');
  expect(await screen.findByText('No heads found')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^Reason for transfer/), { target: { value: REASON } });
  expect(screen.getByRole('button', { name: 'Transfer to IST' })).toBeDisabled();
});

it('shows a refused conversion without reporting success', async () => {
  vi.mocked(transferMember).mockRejectedValue(
    new ApiError({
      code: 'CONFLICT',
      message: 'OST accreditation must expire before a team change can be approved.',
      status: 409,
    }),
  );
  const onTransferred = show();
  await pickPosition('sales_manager');
  const head = await screen.findByLabelText('Senior Sales Manager');
  await waitFor(() => expect(head).toBeEnabled());
  fireEvent.change(head, { target: { value: SSM.id } });
  fireEvent.change(screen.getByLabelText(/^Reason for transfer/), { target: { value: REASON } });
  fireEvent.click(screen.getByRole('button', { name: 'Transfer to IST' }));
  expect(
    await screen.findByText('OST accreditation must expire before a team change can be approved.'),
  ).toBeInTheDocument();
  expect(onTransferred).not.toHaveBeenCalled();
});

it('reuses the request id when a failed attempt is retried', async () => {
  vi.mocked(transferMember)
    .mockRejectedValueOnce(new ApiError({ code: 'INTERNAL', message: 'boom', status: 500 }))
    .mockResolvedValueOnce(member);
  const onTransferred = show();
  await pickPosition('sales_manager');
  const head = await screen.findByLabelText('Senior Sales Manager');
  await waitFor(() => expect(head).toBeEnabled());
  fireEvent.change(head, { target: { value: SSM.id } });
  fireEvent.change(screen.getByLabelText(/^Reason for transfer/), { target: { value: REASON } });
  const submit = screen.getByRole('button', { name: 'Transfer to IST' });
  fireEvent.click(submit);
  expect(await screen.findByText('boom')).toBeInTheDocument();
  fireEvent.click(submit);
  await waitFor(() => expect(onTransferred).toHaveBeenCalledOnce());
  const [first, second] = vi.mocked(transferMember).mock.calls;
  expect(first![1].requestId).toBe(second![1].requestId);
});
