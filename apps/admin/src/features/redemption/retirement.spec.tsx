import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { ADMIN_NAV_ITEMS } from '../../app/navigation';
import { RedemptionWorkflowPage } from './RedemptionWorkflowPage';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [], meta: {} }), { status: 200 })),
  );
});

describe('points spending retirement', () => {
  it('offers earning claims without member lookup or catalog spending controls', async () => {
    renderWithProviders(<RedemptionWorkflowPage />);
    await screen.findByRole('heading', { name: 'Redeem Points' });
    expect(screen.queryByLabelText('Member code')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /look up|redeem|spend|use points/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Redemption items')).not.toBeInTheDocument();
  });

  it('withdraws spending and lookup entries from Redemption navigation', () => {
    const group = ADMIN_NAV_ITEMS.find((item) => item.to === '/admin/redemption');
    expect(group?.dropdown?.map((item) => item.label)).not.toEqual(
      expect.arrayContaining(['Redemption Catalog']),
    );
    expect(group?.dropdown?.map((item) => item.label)).not.toEqual(
      expect.arrayContaining(['Use Points']),
    );
    expect(group?.dropdown?.map((item) => item.label)).not.toEqual(
      expect.arrayContaining(['Member Lookup']),
    );
  });
});
