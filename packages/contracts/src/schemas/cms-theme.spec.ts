import { describe, expect, it } from 'vitest';
import { SiteConfigSchema } from './cms-content';
import {
  DEFAULT_SITE_THEME,
  SITE_THEME_PRESETS,
  SiteThemeSchema,
  contrastRatio,
  deriveThemePalette,
  hexColorSchema,
  mixHex,
  themeContrastIssues,
} from './cms-theme';

describe('hexColorSchema', () => {
  it('normalises shorthand and uppercase hex to lowercase #rrggbb', () => {
    expect(hexColorSchema.parse('#ABC')).toBe('#aabbcc');
    expect(hexColorSchema.parse('#57AB4B')).toBe('#57ab4b');
  });
  it('rejects names, bad digits and CSS injection', () => {
    for (const bad of ['red', '#12345g', '#1234', 'red; background:url(x)', ''])
      expect(hexColorSchema.safeParse(bad).success).toBe(false);
  });
});

describe('colour maths', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
  it('mixes per channel in sRGB', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#57ab4b', '#000000', 1)).toBe('#57ab4b');
  });
  it('derives the full palette from the five inputs', () => {
    const palette = deriveThemePalette(DEFAULT_SITE_THEME);
    expect(Object.keys(palette)).toHaveLength(45);
    expect(palette['--color-leaf-500']).toBe('#57ab4b');
    expect(palette['--color-gold-500']).toBe('#fbc75e');
    expect(palette['--color-cream-50']).toBe('#fcfbf8');
    expect(palette['--color-ink-800']).toBe('#242b26');
    expect(palette['--color-navy-900']).toBe('#1f2b52');
    for (const value of Object.values(palette)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('SiteThemeSchema', () => {
  it('accepts the default and every preset', () => {
    expect(SiteThemeSchema.safeParse(DEFAULT_SITE_THEME).success).toBe(true);
    expect(SITE_THEME_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const preset of SITE_THEME_PRESETS)
      expect(SiteThemeSchema.safeParse(preset.theme).success, preset.name).toBe(true);
  });
  it('rejects unreadable text with a named pair', () => {
    const theme = { ...DEFAULT_SITE_THEME, text: '#eeeeee', background: '#ffffff' };
    expect(themeContrastIssues(theme).map((i) => i.pair)).toContain('Text on background');
    const result = SiteThemeSchema.safeParse(theme);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes('Text on background'))).toBe(true);
  });
  it('rejects unknown keys and missing colours', () => {
    expect(SiteThemeSchema.safeParse({ ...DEFAULT_SITE_THEME, extra: '#000000' }).success).toBe(
      false,
    );
    const { dark: _dark, ...missing } = DEFAULT_SITE_THEME;
    expect(SiteThemeSchema.safeParse(missing).success).toBe(false);
  });
  it('is an optional part of the site settings document', () => {
    expect(SiteConfigSchema.shape.theme.safeParse(undefined).success).toBe(true);
    expect(SiteConfigSchema.shape.theme.safeParse(DEFAULT_SITE_THEME).success).toBe(true);
    expect(SiteConfigSchema.shape.theme.safeParse({ primary: 'red' }).success).toBe(false);
  });
});
