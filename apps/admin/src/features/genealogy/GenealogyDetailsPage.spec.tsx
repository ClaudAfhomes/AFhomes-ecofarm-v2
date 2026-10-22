import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { GenealogyDetailsPage } from './GenealogyDetailsPage';
import { getGenealogyNode, getGenealogySummary, getGenealogyUpline, getGenealogyDownline, getTeamSalesAnalytics } from './services';

vi.mock('./services', () => ({
  getGenealogyNode: vi.fn(),
  getGenealogySummary: vi.fn(),
  getGenealogyUpline: vi.fn(),
  getGenealogyDownline: vi.fn(),
  getTeamSalesAnalytics: vi.fn(),
}));
const node = {
  staffId: '11111111-1111-4111-8111-111111111111',
  fullName: 'QA SELLER',
  role: 'sales_manager' as const,
  status: 'active' as const,
  ostStatus: null,
  uplineStaffId: null,
  directDownlineCount: 0,
  totalDescendantCount: 0,
};
beforeEach(() => {
  vi.mocked(getGenealogyNode).mockResolvedValue(node);
  vi.mocked(getGenealogySummary).mockResolvedValue({
    staffId: node.staffId,
    totalDirectDownline: 1,
    totalDescendants: 3,
    activeSellerCount: 2,
    inactiveSellerCount: 1,
    roleCounts: { vice_director: 0, senior_sales_manager: 0, sales_manager: 1, ost: 2 },
  });
  vi.mocked(getGenealogyUpline).mockResolvedValue([]);
  vi.mocked(getGenealogyDownline).mockResolvedValue([]);
  vi.mocked(getTeamSalesAnalytics).mockResolvedValue({
    period: 'month',
    window: { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z', timezone: 'UTC' },
    viewerStaffId: node.staffId,
    viewerRole: 'sales_manager',
    kpis: {
      totalTeamSales: 0,
      membersWithSales: 0,
      membersNoSales: 0,
      topSellerCount: 0,
      participationRate: 0,
    },
    members: [],
  });
});
function renderDetails() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/genealogy/:staffId" element={<GenealogyDetailsPage />} />
    </Routes>,
    { route: `/admin/genealogy/${node.staffId}` },
  );
}
it('renders the head with scoped summary badges, never the full chain', async () => {
  vi.mocked(getGenealogyUpline).mockResolvedValue([
    {
      ...node,
      staffId: '22222222-2222-4222-8222-222222222222',
      fullName: 'QA HEAD',
      role: 'senior_sales_manager',
    },
    {
      ...node,
      staffId: '33333333-3333-4333-8333-333333333333',
      fullName: 'QA GRANDHEAD',
      role: 'vice_director',
    },
  ]);
  renderDetails();
  expect(await screen.findByRole('link', { name: 'QA HEAD' })).toHaveAttribute(
    'href',
    '/admin/genealogy/22222222-2222-4222-8222-222222222222',
  );
  expect(screen.queryByRole('link', { name: 'QA GRANDHEAD' })).toBeNull();
  expect(screen.queryByText('Total descendants: 3')).toBeNull();
  expect(await screen.findByText('Direct downline: 1')).toBeInTheDocument();
});
it('shows a retryable upperline error instead of claiming the seller is top-level', async () => {
  vi.mocked(getGenealogyUpline).mockRejectedValue(new Error('Private SQL'));
  renderDetails();
  expect(await screen.findByRole('alert')).not.toHaveTextContent('Private SQL');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(screen.queryByText('Top-level seller')).not.toBeInTheDocument();
});
it('shows top-level only after a successful empty upperline response', async () => {
  renderDetails();
  expect(await screen.findByText('Top-level seller')).toBeInTheDocument();
});
