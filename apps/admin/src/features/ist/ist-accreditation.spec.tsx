import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { SaleTeamAccreditationCard } from '../afhomes/SaleTeamAccreditationCard';

vi.mock('../../lib/api/client', () => ({
  setApiAccessTokenForTests: vi.fn(),
  protectedRequest: vi
    .fn()
    .mockResolvedValue({
      aaNumber: 'AAI26100001',
      kind: 'IST',
      fullName: 'MARIA SANTOS',
      status: 'accredited',
      startsOn: '2026-01-01',
      expiresOn: '2026-12-31',
      photoUrl: null,
    }),
}));

it('shows the existing validity dates when the IST portal requests them', async () => {
  renderWithProviders(<SaleTeamAccreditationCard kind="IST" showValidityDates />);
  expect(await screen.findByText('2026-12-31')).toBeInTheDocument();
  expect(screen.getByText('2026-01-01')).toBeInTheDocument();
  expect(screen.getByText('AAI26100001')).toBeInTheDocument();
});

it('preserves the existing employee identity display for other callers', async () => {
  renderWithProviders(<SaleTeamAccreditationCard kind="IST" />);
  expect(await screen.findByText('AAI26100001')).toBeInTheDocument();
  expect(screen.queryByText('Valid until')).not.toBeInTheDocument();
});
