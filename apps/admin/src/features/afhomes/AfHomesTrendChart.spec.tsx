import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AnalyticsOverview } from '@jad/contracts';

import { AfHomesTrendChart, TrendChartSkeleton, trendLabel } from './AfHomesTrendChart';

/**
 * jsdom has no ResizeObserver; recharts ResponsiveContainer needs one. The
 * stub reports a fixed 800x280 viewport on observe so the chart renders
 * synchronously enough for assertions (same approach as JAD's chart spec).
 */
class ResizeObserverStub {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe = () => {
    this.cb(
      [
        {
          target: { clientWidth: 800, clientHeight: 280 } as unknown as Element,
          contentRect: { width: 800, height: 280 } as unknown as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  };
  unobserve = () => {};
  disconnect = () => {};
}

const g = globalThis as unknown as { ResizeObserver?: unknown };
g.ResizeObserver = g.ResizeObserver ?? ResizeObserverStub;

const overview = (periods: { period: string; sales: number; saleValue: string; verifiedPayments: string }[]): AnalyticsOverview => ({
  period: 'month',
  window: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', timezone: 'UTC' },
  scope: {
    kind: 'global',
    viewerStaffId: '00000000-0000-4000-8000-000000000001',
    viewerRole: 'test',
    attributedSaleCount: 0,
    unattributedLegacySaleCount: 0,
    unattributedLegacySaleValue: '0.00',
  },
  headline: {
    totalCustomers: 0,
    newCustomers: 0,
    totalCardSales: 0,
    periodSales: 0,
    grossFrozenSaleValue: '0.00',
    periodVerifiedPayments: '0.00',
    activatedMemberships: 0,
  },
  queues: {
    pendingPaymentVerification: 0,
    activationReadySales: 0,
    fullPaidSales: 0,
    rejectedPayments: 0,
    spotCashActive: 0,
    spotCashExpired: 0,
  },
  sellers: null,
  organization: null,
  networkContext: null,
  commissions: null,
  redemptions: null,
  salesByPlan: [],
  salesByScheme: [],
  trends: periods.map((p) => ({
    ...p,
    activations: 0,
    redemptions: 0,
    pointsRedeemed: 0,
  })),
});

describe('trendLabel', () => {
  it('labels hourly, daily, and monthly buckets', () => {
    expect(trendLabel('2026-09-15T09:00')).toBe('09:00');
    expect(trendLabel('2026-09-15')).toBe('Sep 15');
    expect(trendLabel('2026-09')).toBe("Sep '26");
  });
});

describe('AfHomesTrendChart (JAD chart grammar)', () => {
  const data = overview([
    { period: '2026-09-01', sales: 2, saleValue: '60000.00', verifiedPayments: '25000.00' },
    { period: '2026-09-15', sales: 1, saleValue: '30000.00', verifiedPayments: '30000.00' },
  ]);

  it('renders the line/area chart with KPIs and the metric toggle', async () => {
    const { container } = render(<AfHomesTrendChart data={data} />);
    expect(screen.getByText('Activity trend')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    // Line + area geometry, no bar columns.
    expect(container.querySelector('.recharts-line')).not.toBeNull();
    expect(container.querySelector('.recharts-area')).not.toBeNull();
    expect(container.querySelector('.recharts-xAxis')).not.toBeNull();
    expect(container.querySelector('.recharts-yAxis')).not.toBeNull();
    expect(screen.getByText('Current bucket')).toBeInTheDocument();
    expect(screen.getByText('Previous bucket')).toBeInTheDocument();
    expect(screen.getByText('₱30,000.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sale value (₱)' })).toBeInTheDocument();
  });

  it('switches the plotted metric without refetching', async () => {
    const { container } = render(<AfHomesTrendChart data={data} />);
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verified (₱)' }));
    expect(screen.getByText('₱30,000.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Count' }));
    expect(screen.getByText('3 sales')).toBeInTheDocument();
  });

  it('renders the no-data state when the period is empty', () => {
    render(<AfHomesTrendChart data={overview([])} />);
    expect(screen.getByText('No activity in this period')).toBeInTheDocument();
  });

  it('shows a chart-shaped loading skeleton', () => {
    render(<TrendChartSkeleton />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading trend…');
  });
});
