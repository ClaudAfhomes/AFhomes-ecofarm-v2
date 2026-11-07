import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { GenealogyPage } from './GenealogyPage';
import { getGenealogy, getGenealogyDownline, getGenealogyNode } from './services';

vi.mock('./services', () => ({
  getGenealogy: vi.fn(),
  getGenealogyDownline: vi.fn(),
  getGenealogyNode: vi.fn(),
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
  const testUser = {
    id: node.staffId,
    name: node.fullName,
    email: 'test@test.com',
    roleId: 'role-sm',
    roleSlug: 'sales_manager' as const,
    roleName: 'Sales Manager',
    status: 'active' as const,
    afHomesPermissions: [],
  };

  beforeEach(() => {
    vi.mocked(getGenealogy).mockReset().mockResolvedValue([node]);
    vi.mocked(getGenealogyNode).mockReset().mockResolvedValue(node);
    vi.mocked(getGenealogyDownline).mockReset().mockResolvedValue([]);
  });
  it.each(['claud', 'SELL', '11111111', 'sales manager', 'sales_manager'])(
    'matches %s within the returned tree',
    async (term) => {
      renderWithProviders(<GenealogyPage />, { user: testUser });
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
    renderWithProviders(<GenealogyPage />, { user: testUser });
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

  const testUser = {
    id: vd.staffId,
    name: vd.fullName,
    email: 'vd@test.com',
    roleId: 'role-vd',
    roleSlug: 'vice_director' as const,
    roleName: 'Vice Director',
    status: 'active' as const,
    afHomesPermissions: [],
  };

  beforeEach(() => {
    vi.mocked(getGenealogy).mockReset().mockResolvedValue([vd, sm, ost]);
    vi.mocked(getGenealogyNode).mockReset().mockImplementation((id) => {
      if (id === vd.staffId) return Promise.resolve(vd);
      if (id === sm.staffId) return Promise.resolve(sm);
      if (id === ost.staffId) return Promise.resolve(ost);
      return Promise.resolve(vd); // Return a valid node instead of null
    });
    vi.mocked(getGenealogyDownline).mockReset().mockImplementation((id) => {
      if (id === vd.staffId) return Promise.resolve([sm, ost]);
      if (id === sm.staffId) return Promise.resolve([ost]);
      return Promise.resolve([]);
    });
  });

  it('shows own genealogy tree with downline for VD user', async () => {
    renderWithProviders(<GenealogyPage />, { user: testUser });
    await screen.findByText('VD TOP HEAD');
    // VD is at the top - no upline chain shown
    expect(screen.queryByText('Your Upline')).toBeNull();
    // Tree shows VD as root with direct downline (SM)
    expect(screen.getByText('SM DOWN ONE')).toBeInTheDocument();
    // OST is under SM which is collapsed by default
    expect(screen.queryByText('OST DOWN TWO')).toBeNull();
    // No "View genealogy" button for self
    expect(screen.queryByRole('button', { name: 'View genealogy of VD TOP HEAD' })).toBeNull();
  });

  it('can click downline member to navigate to their genealogy', async () => {
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
      { route: '/admin/genealogy', user: testUser },
    );
    await screen.findByText('SM DOWN ONE');
    // Click on SM node in the tree (it's clickable)
    fireEvent.click(screen.getByText('SM DOWN ONE'));
    await waitFor(() =>
      expect(screen.getByLabelText('route')).toHaveTextContent(
        '/admin/genealogy/00000000-0000-4000-8000-0000000000a2',
      ),
    );
  });

  it('can expand SM and click OST member to navigate to their genealogy', async () => {
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
      { route: '/admin/genealogy', user: testUser },
    );
    await screen.findByText('SM DOWN ONE');
    // Expand SM to reveal OST
    fireEvent.click(screen.getByRole('button', { name: 'Expand SM DOWN ONE' }));
    await screen.findByText('OST DOWN TWO');
    fireEvent.click(screen.getByText('OST DOWN TWO'));
    await waitFor(() =>
      expect(screen.getByLabelText('route')).toHaveTextContent(
        '/admin/genealogy/00000000-0000-4000-8000-0000000000a3',
      ),
    );
  });
});
