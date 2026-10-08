import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SettlementBadge } from './SettlementBadge';

describe('SettlementBadge', () => {
  it('badges settled money green', () => {
    const { container } = render(
      <SettlementBadge total="60000.00" paid="60000.00" balance="0.00" />,
    );
    expect(screen.getByText('Fully Paid')).toBeInTheDocument();
    expect(container.firstChild?.nodeName).toBe('SPAN');
    expect((container.firstChild as HTMLElement).className).toMatch(/success/);
  });

  it('badges owing money orange', () => {
    const { container } = render(
      <SettlementBadge total="60000.00" paid="15000.00" balance="45000.00" />,
    );
    expect(screen.getByText('Unsettled')).toBeInTheDocument();
    expect((container.firstChild as HTMLElement).className).toMatch(/warning/);
  });
});
