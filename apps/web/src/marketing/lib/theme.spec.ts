import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_THEME, deriveThemePalette } from '@afhomes/contracts';
import { themeStyle } from './theme';

describe('themeStyle', () => {
  it('leaves the site untouched when no valid theme is published', () => {
    expect(themeStyle(undefined)).toBeUndefined();
    expect(themeStyle('x')).toBeUndefined();
    expect(themeStyle({ primary: '#57ab4b' })).toBeUndefined();
  });

  it('ignores a theme carrying CSS injection', () => {
    expect(
      themeStyle({ ...DEFAULT_SITE_THEME, primary: 'red; background:url(x)' }),
    ).toBeUndefined();
  });

  it('ignores an unreadable theme even if it reached the site', () => {
    expect(themeStyle({ ...DEFAULT_SITE_THEME, text: '#eeeeee', background: '#ffffff' })).toBe(
      undefined,
    );
  });

  it('maps a valid theme onto the marketing palette variables', () => {
    const style = themeStyle(DEFAULT_SITE_THEME) as Record<string, string>;
    expect(style['--color-leaf-500']).toBe('#57ab4b');
    expect(style['--color-navy-900']).toBe('#1f2b52');
  });

  it('re-points the semantic aliases, which :root would otherwise freeze at the defaults', () => {
    const theme = { ...DEFAULT_SITE_THEME, primary: '#336699', background: '#f5f7fa' };
    const palette = deriveThemePalette(theme);
    const style = themeStyle(theme) as Record<string, string>;
    expect(style['--color-surface']).toBe(palette['--color-cream-100']);
    expect(style['--color-background']).toBe(palette['--color-cream-50']);
    expect(style['--color-primary']).toBe('#336699');
    expect(style['--color-primary-dark']).toBe(palette['--color-pine-800']);
    expect(style['--color-text-muted']).toBe(palette['--color-ink-500']);
  });
});
