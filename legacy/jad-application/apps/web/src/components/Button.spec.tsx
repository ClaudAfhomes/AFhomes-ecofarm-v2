import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import { renderWithProviders } from '../test/utils';
import styles from './Button.module.css';

function variantClass(name: keyof typeof styles): string {
  const cls = styles[name];
  expect(cls).toBeDefined();
  return cls ?? '';
}

describe('Button', () => {
  it('renders its label with primary variant by default', () => {
    renderWithProviders(<Button>Submit</Button>);
    const button = screen.getByRole('button', { name: 'Submit' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
    expect(button).not.toBeDisabled();
    expect(button).toHaveClass(variantClass('button'), variantClass('primary'));
  });

  it('applies the secondary variant class so the label renders white on navy', () => {
    renderWithProviders(<Button variant="secondary">Retry</Button>);
    const button = screen.getByRole('button', { name: 'Retry' });
    expect(button).toHaveClass(variantClass('button'), variantClass('secondary'));
    expect(button).not.toHaveClass(variantClass('primary'));
  });

  it('disables while loading and announces status', () => {
    renderWithProviders(<Button loading>Submit</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
