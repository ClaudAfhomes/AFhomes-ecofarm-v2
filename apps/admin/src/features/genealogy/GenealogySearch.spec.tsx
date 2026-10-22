import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { GenealogyPage } from './GenealogyPage';
import { getGenealogy } from './services';

vi.mock('./services', () => ({
  getGenealogy: vi.fn(),
  getTeamSalesOverview: vi.fn(),
  teamSalesKeys: {
    overview: (period: string) => ['team-sales', 'overview', period],
  },
}));
const node = {
  staffId: '11111111-1111-4111-8111-111111111111',
  fullName: 'CLAUD SELLER',
  role: 'sales_manager' as const,
  status: 'active' as const,
  ostStatus: null,
  uplineStaffId: null,
  directDownlineCount: 0,
  totalDescendantCount: 0,
};

describe('authorized genealogy live search', () => {
  beforeEach(() => {
    vi.mocked(getGenealogy).mockReset().mockResolvedValue([node]);
  });
  it.each(['claud', 'SELL', '11111111', 'sales manager', 'sales_manager'])(
    'matches %s within the returned tree',
    async (term) => {
      renderWithProviders(<GenealogyPage />);
      await screen.findByText(node.fullName);
      fireEvent.change(screen.getByLabelText('Search genealogy'), {
        target: { value: '__NO_SUCH_SELLER__' },
      });
      await screen.findByText('No matching records.');
      fireEvent.change(screen.getByLabelText('Search genealogy'), { target: { value: term } });
      await waitFor(() => expect(screen.getByText(node.fullName)).toBeInTheDocument());
      expect(getGenealogy).toHaveBeenCalledTimes(1);
    },
  );
  it('debounces unmatched text, retains filters, and clears to the authorized tree', async () => {
    renderWithProviders(<GenealogyPage />);
    await screen.findByText(node.fullName);
    fireEvent.change(screen.getByLabelText('Filter role'), { target: { value: 'sales_manager' } });
    const input = screen.getByLabelText('Search genealogy');
    fireEvent.change(input, { target: { value: '__NO_SUCH_SELLER__' } });
    expect(screen.getByText(node.fullName)).toBeInTheDocument();
    await screen.findByText('No matching records.');
    fireEvent.change(input, { target: { value: '' } });
    await screen.findByText(node.fullName);
    expect(screen.getByLabelText('Filter role')).toHaveValue('sales_manager');
    expect(getGenealogy).toHaveBeenCalledTimes(1);
  });
});

describe('genealogy head and tree', () => {
  const vd = {
    staffId: '00000000-0000-4000-8000-0000000000a1',
    fullName: 'VD TOP HEAD',
    role: 'vice_director' as const,
    status: 'active' as const,
    ostStatus: null,
    uplineStaffId: null,
    directDownlineCount: 1,
    totalDescendantCount: 2,
  };
  const sm = {
    ...vd,
    staffId: '00000000-0000-4000-8000-0000000000a2',
    fullName: 'SM DOWN ONE',
    role: 'sales_manager' as const,
    uplineStaffId: vd.staffId,
    directDownlineCount: 1,
    totalDescendantCount: 1,
  };
  const ost = {
    ...vd,
    staffId: '00000000-0000-4000-8000-0000000000a3',
    fullName: 'OST DOWN TWO',
    role: 'ost' as const,
    uplineStaffId: sm.staffId,
    directDownlineCount: 0,
    totalDescendantCount: 0,
  };

  beforeEach(() => {
    vi.mocked(getGenealogy).mockReset().mockResolvedValue([vd, sm, ost]);
  });

  it('shows the head card with a per-card View Genealogy action', async () => {
    renderWithProviders(<GenealogyPage />);
    await screen.findByText('VD TOP HEAD');
    expect(screen.getByText('Network head')).toBeInTheDocument();
    // Only the head shows; the rest of the network opens from a card.
    expect(screen.queryByText('SM DOWN ONE')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'View genealogy of VD TOP HEAD' }),
    ).toBeInTheDocument();
    // The old standalone toggle is gone.
    expect(screen.queryByRole('button', { name: 'View Genealogy' })).toBeNull();
  });

  it('opens the seller record from the card button', async () => {
    const Probe = () => {
      const location = useLocation();
      return (
        <p role="status" aria-label="route">
          {location.pathname}
        </p>
      );
    };
    renderWithProviders(
      <Routes>
        <Route path="/admin/genealogy" element={<GenealogyPage />} />
        <Route path="*" element={<Probe />} />
      </Routes>,
      { route: '/admin/genealogy' },
    );
    await screen.findByText('VD TOP HEAD');
    fireEvent.click(screen.getByRole('button', { name: 'View genealogy of VD TOP HEAD' }));
    await waitFor(() =>
      expect(screen.getByLabelText('route')).toHaveTextContent(
        '/admin/genealogy/00000000-0000-4000-8000-0000000000a1',
      ),
    );
  });

  it('opens the detail record from each head name link', async () => {
    const Probe = () => {
      const location = useLocation();
      return (
        <p role="status" aria-label="route">
          {location.pathname}
        </p>
      );
    };
    renderWithProviders(
      <Routes>
        <Route path="/admin/genealogy" element={<GenealogyPage />} />
        <Route path="*" element={<Probe />} />
      </Routes>,
      { route: '/admin/genealogy' },
    );
    await screen.findByText('VD TOP HEAD');
    fireEvent.click(screen.getByRole('link', { name: 'VD TOP HEAD' }));
    await waitFor(() =>
      expect(screen.getByLabelText('route')).toHaveTextContent(
        '/admin/genealogy/00000000-0000-4000-8000-0000000000a1',
      ),
    );
  });
});
