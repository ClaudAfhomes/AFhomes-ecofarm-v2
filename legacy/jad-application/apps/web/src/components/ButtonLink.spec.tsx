import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ButtonLink } from './ButtonLink';
import { renderWithProviders } from '../test/utils';
import styles from './Button.module.css';

function variantClass(name: keyof typeof styles): string {
  const cls = styles[name];
  expect(cls).toBeDefined();
  return cls ?? '';
}

describe('ButtonLink', () => {
  it('renders a router link for internal routes', () => {
    renderWithProviders(<ButtonLink to="/properties">Explore</ButtonLink>);

    const link = screen.getByRole('link', { name: 'Explore' });
    expect(link).toHaveAttribute('href', '/properties');
    expect(link).not.toHaveAttribute('target');
    expect(link).toHaveClass(variantClass('button'), variantClass('primary'));
  });

  it('applies the primary variant class (white label on brand blue)', () => {
    renderWithProviders(
      <ButtonLink to="/contact" variant="primary">
        Talk to Us
      </ButtonLink>,
    );

    const link = screen.getByRole('link', { name: 'Talk to Us' });
    expect(link).toHaveClass(variantClass('button'), variantClass('primary'));
  });

  it('applies the secondary variant class (white label on navy)', () => {
    renderWithProviders(
      <ButtonLink to="/properties" variant="secondary">
        View Properties
      </ButtonLink>,
    );

    const link = screen.getByRole('link', { name: 'View Properties' });
    expect(link).toHaveClass(variantClass('button'), variantClass('secondary'));
  });

  it('applies the outlineLight variant class for dark/hero surfaces', () => {
    renderWithProviders(
      <ButtonLink href="/discover" variant="outlineLight">
        Discover
      </ButtonLink>,
    );

    const link = screen.getByRole('link', { name: 'Discover' });
    expect(link).toHaveClass(variantClass('button'), variantClass('outlineLight'));
  });

  it('merges an extra className without dropping the button classes', () => {
    renderWithProviders(
      <ButtonLink to="/properties" variant="secondary" className="extra-class">
        View Details
      </ButtonLink>,
    );

    const link = screen.getByRole('link', { name: 'View Details' });
    expect(link).toHaveClass(variantClass('button'), variantClass('secondary'), 'extra-class');
  });

  it('renders a plain anchor for external URLs', () => {
    renderWithProviders(
      <ButtonLink href="https://example.com" target="_blank" rel="noreferrer">
        External
      </ButtonLink>,
    );

    const link = screen.getByRole('link', { name: 'External' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('keeps white labels on visited links (global a:visited must not win)', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/Button.module.css'), 'utf8');
    expect(css).toMatch(/\.primary:visited\s*\{/);
    expect(css).toMatch(/\.secondary:visited\s*[,{]/);
    expect(css).toMatch(/\.outlineLight:visited\s*\{/);
    expect(css).not.toMatch(/!important/);
  });

  it('keeps white nav labels on visited links', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/MobileNavigation.module.css'), 'utf8');
    expect(css).toMatch(/a\.link:visited\s*,/);
    expect(css).toMatch(/a\.active:visited\s*\{/);
  });
});
