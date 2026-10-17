vi.mock('../ost/services', () => ({
  getOstSponsors: vi
    .fn()
    .mockResolvedValue([
      { id: '11111111-2222-4333-8444-555555555555', name: 'VERIFIED ACTIVE SM' },
    ]),
}));
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { CreateOstDialog } from './CreateOstDialog';

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
  expect(screen.getByRole('combobox', { name: /^Province/ })).toBeDisabled();
  expect(await screen.findByRole('option', { name: 'VERIFIED ACTIVE SM' })).toBeInTheDocument();
  for (const [label, choice] of [
    ['Region', 'CALABARZON'],
    ['Province', 'Laguna'],
    ['City', 'Calauan'],
    ['Barangay', 'Dayap'],
  ]) {
    await user.click(screen.getByRole('combobox', { name: new RegExp('^' + label) }));
    await user.click(screen.getByRole('option', { name: new RegExp('^' + choice) }));
  }
  expect(screen.getByLabelText(/^ZIP \/ postal/)).toHaveValue('4012');
  expect(screen.getByLabelText(/^ZIP \/ postal/)).toHaveAttribute('readonly');
  await user.click(screen.getByRole('combobox', { name: /^Region/ }));
  await user.click(screen.getByRole('option', { name: 'NCR' }));
  expect(screen.getByLabelText(/^ZIP \/ postal/)).toHaveValue('');
});

it('calculates a one-year expiry including leap day instead of accepting an arbitrary expiry', () => {
  renderWithProviders(<CreateOstDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/^Approved Start/), { target: { value: '2028-02-29' } });
  expect(screen.getByLabelText(/^Approved Expiry/)).toHaveValue('2029-02-28');
  expect(screen.getByLabelText(/^Approved Expiry/)).toBeDisabled();
});
