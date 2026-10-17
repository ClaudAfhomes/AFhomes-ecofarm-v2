vi.mock('../ost/services', () => ({
  getOstSponsors: vi
    .fn()
    .mockResolvedValue([
      { id: '11111111-2222-4333-8444-555555555555', name: 'VERIFIED ACTIVE SM' },
    ]),
}));
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { CreateOstDialog } from './CreateOstDialog';
import { createOstMember } from './services';

vi.mock('./services', () => ({
  getMemberUplines: vi.fn().mockResolvedValue([]),
  createOstMember: vi.fn(),
}));
vi.mock('../address/useOstAddress', () => ({
  useOstAddress: () => {
    const lookup = (data: unknown[]) => ({
      data,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    });
    return {
      regions: lookup([
        { code: '0400000000', name: 'CALABARZON' },
        { code: '1300000000', name: 'NCR' },
      ]),
      provinces: lookup([{ code: '0403400000', name: 'Laguna' }]),
      localities: lookup([
        {
          code: '0403406000',
          name: 'Calauan',
          type: 'municipality',
          provinceCode: '0403400000',
          postalCode: '4012',
        },
      ]),
      barangays: lookup([{ code: '0403406003', name: 'Dayap', localityCode: '0403406000' }]),
    };
  },
}));

it('uses verified address selections and clears stale postal data on the develop creation screen', async () => {
  const user = userEvent.setup();
  renderWithProviders(<CreateOstDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
  expect(screen.queryByRole('combobox', { name: /^Region/ })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: /^Province/ })).toBeEnabled();
  expect(screen.getByLabelText(/^Temporary password/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^AA number mode/i)).toBeInTheDocument();
  expect(await screen.findByRole('option', { name: 'VERIFIED ACTIVE SM' })).toBeInTheDocument();
  for (const [label, choice] of [
    ['Province', 'Laguna'],
    ['City', 'Calauan'],
    ['Barangay', 'Dayap'],
  ]) {
    await user.click(screen.getByRole('combobox', { name: new RegExp('^' + label) }));
    await user.click(screen.getByRole('option', { name: new RegExp('^' + choice) }));
  }
  expect(screen.getByLabelText(/^ZIP \/ postal/)).toHaveValue('4012');
  expect(screen.getByLabelText(/^ZIP \/ postal/)).toHaveAttribute('readonly');
  await user.click(screen.getByRole('button', { name: 'Clear province' }));
  expect(screen.getByLabelText(/^ZIP \/ postal/)).toHaveValue('');
});

it('calculates a one-year expiry including leap day instead of accepting an arbitrary expiry', () => {
  renderWithProviders(<CreateOstDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/^Approved Start/), { target: { value: '2028-02-29' } });
  expect(screen.getByLabelText(/^Approved Expiry/)).toHaveValue('2029-02-28');
  expect(screen.getByLabelText(/^Approved Expiry/)).toBeDisabled();
});

it('submits a password-based manual AA creation with verified geography and an SM sponsor', async () => {
  const user = userEvent.setup();
  const onCreated = vi.fn();
  vi.mocked(createOstMember).mockResolvedValue({
    applicationId: '11111111-2222-4333-8444-555555555555',
    memberId: '22222222-2222-4333-8444-555555555555',
    status: 'approved',
  });
  renderWithProviders(<CreateOstDialog open onClose={vi.fn()} onCreated={onCreated} />);
  for (const [label, value] of [
    ['First Name', 'Test'],
    ['Last Name', 'Person'],
    ['Email', 'synthetic@example.invalid'],
    ['Mobile Number', '09171234567'],
    ['No. / Street', '1 Synthetic Street'],
    ['Birth Date', '1990-01-01'],
    ['Temporary password', 'SyntheticPass123!'],
    ['Confirm password', 'SyntheticPass123!'],
    ['Government ID number', 'P1234567'],
    ['Date applied', '2026-10-01'],
    ['Applicant signature date', '2026-10-01'],
    ['Referrer signature date', '2026-10-01'],
  ])
    fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });
  for (const [label, value] of [
    ['Government ID type', 'passport'],
    ['Program category', 'non_vip'],
    ['Sex', 'male'],
    ['Civil status', 'single'],
    ['Applicant signature$', 'received'],
    ['Referrer signature$', 'received'],
    ['AA number mode', 'manual'],
  ])
    fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });
  fireEvent.change(screen.getByLabelText(/^AA number$/), { target: { value: 'AAO26100001' } });
  await screen.findByRole('option', { name: 'VERIFIED ACTIVE SM' });
  fireEvent.change(screen.getByLabelText(/^Sponsor/), {
    target: { value: '11111111-2222-4333-8444-555555555555' },
  });
  for (const [label, choice] of [
    ['Province', 'Laguna'],
    ['City', 'Calauan'],
    ['Barangay', 'Dayap'],
  ]) {
    await user.click(screen.getByRole('combobox', { name: new RegExp('^' + label) }));
    await user.click(screen.getByRole('option', { name: new RegExp('^' + choice) }));
  }
  await user.click(screen.getByRole('button', { name: 'Create and accredit' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  expect(vi.mocked(createOstMember).mock.calls.at(-1)?.[0]).toEqual(
    expect.objectContaining({
      temporaryPassword: 'SyntheticPass123!',
      aaNumberMode: 'manual',
      aaNumber: 'AAO26100001',
      sponsorStaffId: '11111111-2222-4333-8444-555555555555',
      identity: expect.objectContaining({
        addressHierarchy: {
          provinceCode: '0403400000',
          localityCode: '0403406000',
          barangayCode: '0403406003',
        },
      }),
    }),
  );
});
