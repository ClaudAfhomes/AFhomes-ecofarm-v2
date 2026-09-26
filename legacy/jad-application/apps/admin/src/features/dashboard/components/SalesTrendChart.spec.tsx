import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MOCK_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { SalesTrendChart } from './SalesTrendChart';

/**
 * jsdom has no ResizeObserver; recharts ResponsiveContainer needs one. The
 * stub reports a fixed 800x280 viewport on observe so the chart renders
 * synchronously enough for assertions.
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

describe('SalesTrendChart', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    server = installMockApi();
    server.install();
    g.ResizeObserver = g.ResizeObserver ?? ResizeObserverStub;
  });

  afterEach(() => {
    server.restore();
    vi.restoreAllMocks();
  });

  it('renders the chart with KPIs and toggle controls', async () => {
    const { container } = renderWithProviders(<SalesTrendChart />, { user: MOCK_ADMIN });
    expect(screen.getByText('Sales Overview')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    expect(screen.getByText('Value this month')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Monthly' })[0]).toBeInTheDocument();
  });

  it('switches granularity to yearly and refetches the series', async () => {
    const { container } = renderWithProviders(<SalesTrendChart />, { user: MOCK_ADMIN });
    await waitFor(() => {
      expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    });
    const before = container.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick').length;
    const yearlyButtons = screen.getAllByRole('button', { name: 'Yearly' });
    fireEvent.click(yearlyButtons[0]!);
    await waitFor(() => {
      // Mock sales all fall in the current year -> single yearly bucket,
      // whereas the month view renders 12 monthly ticks.
      const ticks = container.querySelectorAll(
        '.recharts-xAxis .recharts-cartesian-axis-tick',
      ).length;
      expect(ticks).toBe(1);
      expect(screen.getByText(`Value in ${new Date().getUTCFullYear()}`)).toBeInTheDocument();
    });
    expect(before).toBeGreaterThan(0);
  });
});
