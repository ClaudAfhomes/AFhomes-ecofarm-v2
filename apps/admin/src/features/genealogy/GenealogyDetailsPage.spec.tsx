import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { GenealogyDetailsPage } from './GenealogyDetailsPage';
import { getGenealogyNode, getGenealogySummary, getGenealogyUpline } from './services';

vi.mock('./services', () => ({
  getGenealogyNode: vi.fn(),
  getGenealogySummary: vi.fn(),
  getGenealogyUpline: vi.fn(),
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
});
function renderDetails() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/genealogy/:staffId" element={<GenealogyDetailsPage />} />
    </Routes>,
    { route: `/admin/genealogy/${node.staffId}` },
  );
}
it('renders the returned upperline in an ordered list and the scoped summary cards', async () => {
  vi.mocked(getGenealogyUpline).mockResolvedValue([
    {
      ...node,
      staffId: '22222222-2222-4222-8222-222222222222',
      fullName: 'QA UPPERLINE',
      role: 'senior_sales_manager',
    },
  ]);
  renderDetails();
  expect(await screen.findByRole('link', { name: 'QA UPPERLINE' })).toHaveAttribute(
    'href',
    '/admin/genealogy/22222222-2222-4222-8222-222222222222',
  );
  expect(screen.getByRole('list').tagName).toBe('OL');
  expect(await screen.findByRole('article', { name: 'Total descendants: 3' })).toBeInTheDocument();
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
