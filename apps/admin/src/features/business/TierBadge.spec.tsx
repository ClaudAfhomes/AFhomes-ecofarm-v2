import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TierBadge } from './TierBadge';

describe('TierBadge', () => {
  it.each([['GOLD'], ['SILVER'], ['BRONZE']] as const)(
    'renders the %s name in its own treatment',
    (tier) => {
      const { container } = render(<TierBadge tier={tier} />);
      expect(screen.getByText(tier)).toBeInTheDocument();
      expect(container.firstChild?.nodeName).toBe('SPAN');
    },
  );

  it('gives each metal a distinct treatment', () => {
    const classes = (['GOLD', 'SILVER', 'BRONZE'] as const).map((tier) => {
      const { container, unmount } = render(<TierBadge tier={tier} />);
      const cls = (container.firstChild as HTMLElement).className;
      unmount();
      return cls;
    });
    expect(new Set(classes).size).toBe(3);
  });

  it('falls back to neutral text without a tier', () => {
    render(<TierBadge tier={null} />);
    expect(screen.getByText('No tier')).toBeInTheDocument();
  });
});
