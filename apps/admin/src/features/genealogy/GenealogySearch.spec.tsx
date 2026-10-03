import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { GenealogyPage } from './GenealogyPage';
import { getGenealogy } from './services';

vi.mock('./services', () => ({ getGenealogy: vi.fn() }));
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
