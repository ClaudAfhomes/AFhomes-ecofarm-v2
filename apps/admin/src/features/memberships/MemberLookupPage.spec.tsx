import { fireEvent, screen } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { MemberLookupPage } from './MemberLookupPage';
import { renderWithProviders } from '../../test/utils';
import { requestList } from '../../lib/api/client';
vi.mock('../../lib/api/client', () => ({
  requestList: vi.fn(),
  setApiAccessTokenForTests: vi.fn(),
}));
it('searches a card identifier and clearly denies privileges for a suspended member', async () => {
  vi.mocked(requestList).mockResolvedValue([
    {
      memberName: 'Imported Member',
      membershipNumber: 'MBS-000123',
      customerNumber: 'CUS-000123',
      tier: 'GOLD',
      membershipStatus: 'active',
      category: 'SUSPENDED',
      activatedAt: '2025-01-01',
      expiresAt: '2035-01-01',
      availablePoints: '12500',
      mayUsePrivileges: false,
    },
  ]);
  renderWithProviders(<MemberLookupPage />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find member' }), {
    target: { value: 'MBS-000123' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByRole('heading', { name: 'Imported Member' })).toBeInTheDocument();
  expect(screen.getByText('Suspended')).toBeInTheDocument();
  expect(screen.getByText(/VIP privileges unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/Available points: 12500/)).toBeInTheDocument();
});
