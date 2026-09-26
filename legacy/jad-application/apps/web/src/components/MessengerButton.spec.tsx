import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessengerButton } from './MessengerButton';
import { renderWithProviders } from '../test/utils';

const LABEL = 'Message JA&D Realty Services on Messenger';

describe('MessengerButton', () => {
  it('renders an accessible link to the Messenger page with the Let\u2019s Talk label', () => {
    renderWithProviders(<MessengerButton />);

    const link = screen.getByRole('link', { name: LABEL });
    expect(link).toHaveAttribute('href', 'https://m.me/JADRealtyServices');
    expect(within(link).getByText('Let\u2019s Talk')).toBeInTheDocument();
  });

  it('opens in a new tab with safe rel attributes', () => {
    renderWithProviders(<MessengerButton />);

    const link = screen.getByRole('link', { name: LABEL });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('includes a decorative Messenger glyph hidden from assistive tech', () => {
    renderWithProviders(<MessengerButton />);

    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg?.querySelector('path')).toHaveAttribute('d');
  });

  it('pins the white foreground for every link state (regression: global a:visited must not recolor the link)', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/components/MessengerButton.module.css'),
      'utf8',
    );

    for (const state of ['link', 'visited', 'hover', 'active', 'focus', 'focus-visible']) {
      expect(css).toMatch(new RegExp(`\\.button:${state}`));
    }
    const stateBlock = css.match(
      /\.button:(?:link|visited|hover|active|focus|focus-visible)[\s\S]*?\{[\s\S]*?\}/,
    );
    expect(stateBlock?.[0]).toMatch(/color:\s*var\(--color-on-dark\)/);
    expect(css).not.toMatch(/[^-]color:\s*var\(--color-brand-primary\)/);
    expect(css).toMatch(/\.icon[\s\S]*?fill:\s*currentColor/);
  });
});
