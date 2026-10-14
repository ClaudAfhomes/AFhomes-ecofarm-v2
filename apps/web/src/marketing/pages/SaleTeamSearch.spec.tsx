import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import SaleTeamSearch from './SaleTeamSearch';
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../lib/api/client', () => ({ request: api.request }));
vi.mock('../components/ui/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
const record = {
  aaNumber: 'AA-K7Q2M9T4B1R8',
  fullName: 'SYNTHETIC SELLER',
  kind: 'IST',
  status: 'accredited',
  startsOn: '2026-01-01',
  expiresOn: '2027-12-31',
};
beforeEach(() => {
  api.request.mockReset();
});
it.each([
  ['AAI26100001', 'IST'],
  ['AAO26100002', 'OST'],
])('submits an official %s number and displays the verified seller', async (aaNumber, kind) => {
  api.request.mockResolvedValue({ ...record, aaNumber, kind });
  renderWithProviders(<SaleTeamSearch />);
  await userEvent.type(screen.getByLabelText('AA number'), aaNumber.toLowerCase());
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText(aaNumber)).toBeInTheDocument();
  expect(api.request).toHaveBeenCalledWith(
    `/sale-team/search?aaNumber=${aaNumber}`,
    expect.anything(),
    expect.objectContaining({ signal: expect.anything() }),
  );
});
it('searches only on submit and clears a stale verification when input changes', async () => {
  api.request.mockResolvedValue(record);
  renderWithProviders(<SaleTeamSearch />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('AA number'), 'aa-k7q2m9t4b1r8');
  expect(api.request).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText(record.fullName)).toBeInTheDocument();
  expect(api.request).toHaveBeenCalledWith(
    '/sale-team/search?aaNumber=AA-K7Q2M9T4B1R8',
    expect.anything(),
    expect.objectContaining({ signal: expect.anything() }),
  );
  await user.type(screen.getByLabelText('AA number'), '9');
  expect(screen.queryByText(record.fullName)).not.toBeInTheDocument();
});
it('rejects malformed input without a request', async () => {
  renderWithProviders(<SaleTeamSearch />);
  await userEvent.type(screen.getByLabelText('AA number'), '%');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('Enter a valid AA number.')).toBeInTheDocument();
  expect(api.request).not.toHaveBeenCalled();
});
it.each([null, new Error('network')])('shows a safe no-match or retry state: %s', async (value) => {
  if (value instanceof Error) api.request.mockRejectedValue(value);
  else api.request.mockResolvedValue(value);
  renderWithProviders(<SaleTeamSearch />);
  await userEvent.type(screen.getByLabelText('AA number'), record.aaNumber);
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(
    await screen.findByText(
      value === null
        ? 'No current accredited seller found.'
        : 'Verification is unavailable. Please retry using Search.',
    ),
  ).toBeInTheDocument();
});
