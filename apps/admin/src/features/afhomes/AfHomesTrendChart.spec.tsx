import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesTrendReport } from '@afhomes/contracts';

import { renderWithProviders } from '../../test/utils';
import { AfHomesTrendChart, TrendChartSkeleton, periodLabel } from './AfHomesTrendChart';

const getTrend = vi.hoisted(() => vi.fn());
vi.mock('./services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services')>();
  return { ...actual, getAfHomesSalesTrend: getTrend };
});

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

const monthKey = (monthsBack: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const thisYear = () => String(new Date().getUTCFullYear());

/** Monthly series: exact-cent fractions prove string arithmetic (0.10 + 0.20). */
const monthlyReport = (): SalesTrendReport => ({
  granularity: 'month',
  generatedAt: new Date().toISOString(),
  periods: [
    { key: monthKey(2), count: 1, total: '60000.00' },
    { key: monthKey(1), count: 2, total: '0.30' },
    { key: monthKey(0), count: 1, total: '1200000.00' },
  ],
});

const yearlyReport = (): SalesTrendReport => ({
  granularity: 'year',
  generatedAt: new Date().toISOString(),
  periods: [
    { key: String(Number(thisYear()) - 1), count: 1, total: '1000.00' },
    { key: thisYear(), count: 2, total: '2000.00' },
  ],
});

const emptyReport = (): SalesTrendReport => ({
  granularity: 'month',
  generatedAt: new Date().toISOString(),
  periods: [
    { key: monthKey(1), count: 0, total: '0.00' },
    { key: monthKey(0), count: 0, total: '0.00' },
  ],
});

beforeEach(() => {
  getTrend.mockReset();
  getTrend.mockResolvedValue(monthlyReport());
});

const renderChart = () => renderWithProviders(<AfHomesTrendChart />);
/** Plotted line geometry. Axis tick *labels* never paint text in jsdom, but
 *  the line path carries the real scaled values, so a metric switch must
 *  change it while a refetch-free toggle keeps the fetch count at one. */
const lineD = (container: HTMLElement) =>
  (container.querySelector('.recharts-line path') as unknown as { getAttribute?: (n: string) => string } | null)?.getAttribute?.('d') ?? '';

describe('periodLabel (JAD grammar)', () => {
  it('7. labels monthly keys as "Sep \'26"', () => {
    expect(periodLabel('2026-09')).toBe("Sep '26");
    expect(periodLabel('2026-01')).toBe("Jan '26");
  });

  it('8. labels yearly keys as the bare year', () => {
    expect(periodLabel('2026')).toBe('2026');
  });
});

describe('AfHomesTrendChart (JAD Sales Overview parity)', () => {
  it('1. renders the "Sales Overview" title', async () => {
    const { container } = renderChart();
    expect(screen.getByText('Sales Overview')).toBeInTheDocument();
    expect(screen.getByLabelText('Sales overview')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
  });

  it('2. defaults to the Value (₱) metric', async () => {
    const { container } = renderChart();
    expect(getTrend).toHaveBeenCalledWith('month');
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    const valueGeometry = lineD(container);
    expect(valueGeometry).not.toBe('');
    // The initial geometry is the value mapping: switching to Count replotted it.
    fireEvent.click(screen.getByRole('button', { name: 'Count' }));
    await waitFor(() => {
      expect(lineD(container)).not.toBe(valueGeometry);
    });
    expect(getTrend).toHaveBeenCalledTimes(1);
  });

  it('3. switches between Count and Value (₱) without refetching', async () => {
    const { container } = renderChart();
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    const valueGeometry = lineD(container);
    fireEvent.click(screen.getByRole('button', { name: 'Count' }));
    await waitFor(() => {
      expect(lineD(container)).not.toBe(valueGeometry);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Value (₱)' }));
    await waitFor(() => {
      expect(lineD(container)).toBe(valueGeometry);
    });
    expect(getTrend).toHaveBeenCalledTimes(1);
    // JAD KPIs stay money/count aggregates regardless of the plotted metric.
    expect(screen.getByText('4 · ₱1,260,000.30')).toBeInTheDocument();
  });

  it('4/5. toggles Monthly and Yearly granularity with a refetch each way', async () => {
    const user = userEvent.setup();
    const { container } = renderChart();
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    getTrend.mockResolvedValue(yearlyReport());
    await user.click(screen.getByRole('button', { name: 'Yearly' }));
    expect(getTrend).toHaveBeenCalledWith('year');
    await waitFor(() => {
      expect(screen.getByText(`Value in ${thisYear()}`)).toBeInTheDocument();
    });
    getTrend.mockResolvedValue(monthlyReport());
    await user.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(getTrend).toHaveBeenCalledWith('month');
    await waitFor(() => {
      expect(screen.getByText('Value this month')).toBeInTheDocument();
    });
  });

  it('6. no longer offers Verified (₱) or the old sale-value label as a chart metric', async () => {
    const { container } = renderChart();
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'Verified (₱)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sale value (₱)' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Value (₱)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Count' })).toBeInTheDocument();
  });

  it('9/10/11. shows current, previous, and current-year KPIs from server facts', async () => {
    const { container } = renderChart();
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    expect(screen.getByText('Value this month')).toBeInTheDocument();
    expect(screen.getByText('₱1,200,000.00')).toBeInTheDocument();
    expect(screen.getByText('Previous period')).toBeInTheDocument();
    expect(screen.getByText('₱0.30')).toBeInTheDocument();
    expect(screen.getByText('Qualifying sales this year')).toBeInTheDocument();
    expect(screen.getByText('4 · ₱1,260,000.30')).toBeInTheDocument();
  });

  it('12. keeps money exact through the KPI aggregation', async () => {
    const { container } = renderChart();
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    // 60000.00 + 0.30 + 1200000.00 as strings - a float sum would print
    // 1260000.3000000003-style residue instead.
    expect(screen.getByText('4 · ₱1,260,000.30')).toBeInTheDocument();
  });

  it('13. shows an empty state instead of a fake zero line when nothing qualifies', async () => {
    getTrend.mockResolvedValue(emptyReport());
    const { container } = renderChart();
    await waitFor(() => {
      expect(screen.getByText('No qualifying sales yet')).toBeInTheDocument();
    });
    expect(container.querySelector('svg.recharts-surface')).toBeNull();
  });

  it('14. owns its loading state in the chart region', () => {
    getTrend.mockReturnValue(new Promise(() => {}));
    renderChart();
    expect(screen.getByRole('status')).toHaveTextContent('Loading trend…');
  });

  it('15/17. surfaces API errors with retry and renders no figures until then', async () => {
    const user = userEvent.setup();
    getTrend.mockRejectedValueOnce(new Error('boom'));
    getTrend.mockResolvedValue(monthlyReport());
    const { container } = renderChart();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(container.querySelector('svg.recharts-surface')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    expect(screen.getByText('₱1,200,000.00')).toBeInTheDocument();
  });

  it('18. uses AF brand tokens, never JAD blue', async () => {
    const { container } = renderChart();
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    const html = container.innerHTML;
    expect(html).toContain('var(--color-brand-primary)');
    expect(html).toContain('afhomesSalesTrendFill');
    expect(html).not.toMatch(/#(3b82f6|2563eb|1d4ed8)/i);
  });

  it('renders line + area geometry with a horizontal dashed grid only', async () => {
    const { container } = renderChart();
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    expect(container.querySelector('.recharts-line')).not.toBeNull();
    expect(container.querySelector('.recharts-area')).not.toBeNull();
    expect(container.querySelector('.recharts-xAxis')).not.toBeNull();
    expect(container.querySelector('.recharts-yAxis')).not.toBeNull();
    expect(container.querySelector('.recharts-bar')).toBeNull();
  });

  it('shows a chart-shaped loading skeleton', () => {
    renderWithProviders(<TrendChartSkeleton />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading trend…');
  });
});
