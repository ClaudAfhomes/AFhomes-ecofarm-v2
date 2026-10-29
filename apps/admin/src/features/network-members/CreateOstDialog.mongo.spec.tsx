import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { CreateOstDialog } from './CreateOstDialog';
vi.mock('../../lib/cookie-auth', () => ({ isMongoAuth: true }));
vi.mock('../ost/services', () => ({ getOstSponsors: vi.fn().mockResolvedValue([]) }));
vi.mock('./services', () => ({ createOstMember: vi.fn() }));
vi.mock('../address/useOstAddress', () => ({
  useOstAddress: () => {
    const empty = { data: [], isFetching: false, isError: false, refetch: vi.fn() };
    return { regions: empty, provinces: empty, localities: empty, barangays: empty };
  },
}));
it('MongoDB Create OST offers immediate creation and accreditation without a pending registration option', () => {
  renderWithProviders(<CreateOstDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Create and accredit' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Save as pending' })).not.toBeInTheDocument();
});
