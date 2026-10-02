import { fireEvent, screen, waitFor } from '@testing-library/react';
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

it('clears immediately below minimum length and never restores a late previous result', async () => {
  const member = (name: string) => ({
    memberName: name,
    membershipNumber: 'MBS-000123',
    customerNumber: 'CUS-000123',
    tier: 'GOLD' as const,
    membershipStatus: 'active' as const,
    category: 'ACTIVE_VIP' as const,
    activatedAt: null,
    expiresAt: null,
    availablePoints: '10',
    mayUsePrivileges: true,
  });
  let resolveOld: (rows: ReturnType<typeof member>[]) => void = () => {};
  vi.mocked(requestList).mockReset();
  vi.mocked(requestList).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  vi.mocked(requestList).mockResolvedValue([member('NEW MEMBER')]);
  renderWithProviders(<MemberLookupPage />);
  const input = screen.getByRole('searchbox', { name: 'Find member' });
  fireEvent.change(input, { target: { value: 'CLAUD' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(requestList).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: 'C' } });
  expect(screen.getByText('Enter at least two characters to find a member')).toBeInTheDocument();
  resolveOld([member('OLD CLAUD')]);
  await waitFor(() => expect(screen.queryByText('OLD CLAUD')).not.toBeInTheDocument());
  expect(requestList).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: '' } });
  expect(screen.getByText('Enter at least two characters to find a member')).toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'NEW' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('NEW MEMBER')).toBeInTheDocument();
  expect(screen.queryByText('OLD CLAUD')).not.toBeInTheDocument();
  expect(requestList).toHaveBeenCalledTimes(2);
});

it('removes an already displayed result immediately on one-character input', async () => {
  vi.mocked(requestList).mockReset();
  vi.mocked(requestList).mockResolvedValue([
    {
      memberName: 'CLAUD RESULT',
      membershipNumber: 'MBS-123',
      customerNumber: 'CUS-123',
      tier: 'GOLD',
      membershipStatus: 'active',
      category: 'ACTIVE_VIP',
      activatedAt: null,
      expiresAt: null,
      availablePoints: '10',
      mayUsePrivileges: true,
    },
  ]);
  renderWithProviders(<MemberLookupPage />);
  const input = screen.getByRole('searchbox', { name: 'Find member' });
  fireEvent.change(input, { target: { value: 'CLAUD' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('CLAUD RESULT')).toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'C' } });
  expect(screen.queryByText('CLAUD RESULT')).not.toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(requestList).toHaveBeenCalledTimes(1);
});
