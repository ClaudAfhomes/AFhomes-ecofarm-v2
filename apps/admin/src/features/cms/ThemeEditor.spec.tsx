import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SITE_THEME, SITE_THEME_PRESETS } from '@afhomes/contracts';
import { ThemeEditor } from './ThemeEditor';

const setup = (value: unknown = undefined) => {
  const onChange = vi.fn();
  render(<ThemeEditor value={value} onChange={onChange} disabled={false} />);
  return onChange;
};

describe('ThemeEditor', () => {
  it('shows the AF Homes defaults when no theme is set', () => {
    setup();
    expect(screen.getByText('Using the AF Homes default colours.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Primary' })).toHaveValue('#57ab4b');
  });

  it('accepts shorthand hex and reports the normalised colour', async () => {
    const onChange = setup(DEFAULT_SITE_THEME);
    const field = screen.getByRole('textbox', { name: 'Primary' });
    await userEvent.clear(field);
    await userEvent.type(field, '#ABC');
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SITE_THEME, primary: '#aabbcc' });
  });

  it('does not report a half-typed colour', async () => {
    const onChange = setup(DEFAULT_SITE_THEME);
    const field = screen.getByRole('textbox', { name: 'Primary' });
    await userEvent.clear(field);
    await userEvent.type(field, '#12');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies a preset in one click', async () => {
    const onChange = setup(DEFAULT_SITE_THEME);
    const forest = SITE_THEME_PRESETS.find((p) => p.name === 'Forest')!;
    await userEvent.click(screen.getByRole('button', { name: 'Forest' }));
    expect(onChange).toHaveBeenCalledWith(forest.theme);
    expect(screen.getByRole('button', { name: 'AF Homes default' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('resets by removing the custom theme entirely', async () => {
    const onChange = setup(SITE_THEME_PRESETS[1]!.theme);
    await userEvent.click(screen.getByRole('button', { name: 'Reset to AF Homes default' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('names each failing contrast pair', () => {
    setup({ ...DEFAULT_SITE_THEME, text: '#eeeeee', background: '#ffffff' });
    expect(screen.getByText('Fix the colours marked below before saving.')).toBeInTheDocument();
    expect(screen.getByText('Text on background').closest('li')).toHaveTextContent(/Too low/);
  });
});
