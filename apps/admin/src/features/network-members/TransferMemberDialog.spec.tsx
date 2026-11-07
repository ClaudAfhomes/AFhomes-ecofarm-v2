import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { memberSchema } from '@afhomes/contracts';
import { renderWithProviders } from '../../test/utils';
import { TransferMemberDialog } from './TransferMemberDialog';
import { getMember, transferMember, transferOstTeam } from './services';
import { getAccreditation } from '../ost/services';

vi.mock('./services', async (original) => ({
  ...(await original<typeof import('./services')>()),
  getMember: vi.fn(),
  transferMember: vi.fn(),
  transferOstTeam: vi.fn(),
}));
vi.mock('../ost/services', () => ({
  getAccreditation: vi.fn(),
  getOstSponsors: vi
    .fn()
    .mockResolvedValue([{ id: '22222222-2222-4222-8222-222222222222', name: 'SM THREE' }]),
}));
vi.mock('../address/useOstAddress', () => ({
  useOstAddress: () => {
    const lookup = { data: [], isFetching: false, isError: false, refetch: vi.fn() };
    return { regions: lookup, provinces: lookup, localities: lookup, barangays: lookup };
  },
}));
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
  referrerStaffId: '33333333-3333-4333-8333-333333333333',
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
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAccreditation).mockResolvedValue(records('expired'));
  vi.mocked(transferOstTeam).mockResolvedValue(member);
});
it('moves an expired OST to another SM only after explicit approval, without kind conversion', async () => {
  const onTransferred = vi.fn();
  renderWithProviders(
    <TransferMemberDialog member={member} onClose={vi.fn()} onTransferred={onTransferred} />,
  );
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Transfer OST team: SYNTHETIC OST');
  expect(screen.queryByRole('button', { name: 'Transfer to IST' })).not.toBeInTheDocument();
  const choice = await screen.findByRole('option', { name: 'SM THREE' });
  await waitFor(() => expect(choice.closest('select')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('New Sales Manager'), {
    target: { value: '22222222-2222-4222-8222-222222222222' },
  });
  fireEvent.change(screen.getByLabelText(/^Reason for team transfer/), {
    target: { value: 'Approved move to another sales team' },
  });
  const approve = screen.getByRole('button', { name: 'Approve team transfer' });
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(approve);
  await waitFor(() => expect(onTransferred).toHaveBeenCalledOnce());
  expect(transferOstTeam).toHaveBeenCalledWith(
    member.id,
    expect.objectContaining({
      managementApproved: true,
      sponsorStaffId: '22222222-2222-4222-8222-222222222222',
    }),
  );
  expect(transferMember).not.toHaveBeenCalled();
});
it('blocks team approval while OST accreditation is active', async () => {
  vi.mocked(getAccreditation).mockResolvedValue(records('active'));
  renderWithProviders(
    <TransferMemberDialog member={member} onClose={vi.fn()} onTransferred={vi.fn()} />,
  );
  expect(
    await screen.findByText(
      'OST accreditation must expire before a team transfer can be approved.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Approve team transfer' })).toBeDisabled();
  expect(transferOstTeam).not.toHaveBeenCalled();
});
it('labels IST conversion separately and groups its ID type and number together', async () => {
  const ist = {
    ...member,
    position: 'sales_manager' as const,
    positionLabel: 'Sales Manager',
    aaNumber: 'AAI20010001',
  };
  vi.mocked(getMember).mockResolvedValue({ ...ist, tin: null, governmentIdNumber: 'P1234567' });
  renderWithProviders(
    <TransferMemberDialog member={ist} onClose={vi.fn()} onTransferred={vi.fn()} />,
  );
  const identification = within(await screen.findByRole('group', { name: 'Identification' }));
  expect(identification.getByLabelText(/^Government ID type/)).toBeInTheDocument();
  expect(identification.getByLabelText(/^Government ID number/)).toHaveValue('P1234567');
  expect(screen.getByRole('button', { name: 'Convert to OST' })).toBeInTheDocument();
});
