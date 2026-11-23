import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Icon, type IconName } from './Icon';

describe('Icon', () => {
  const customerIcons: IconName[] = ['card', 'calendar', 'star', 'receipt', 'shield-check'];

  it.each(customerIcons)('draws the %s icon as a decorative svg with shapes', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg!.children.length).toBeGreaterThan(0);
  });
});
