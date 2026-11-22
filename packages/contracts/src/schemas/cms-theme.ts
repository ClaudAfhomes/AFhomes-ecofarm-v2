import { z } from 'zod';

/**
 * Public-website theme: five brand colours from which every palette shade is
 * derived. One pure module shared by the API (rejects bad themes), the admin
 * editor (previews + contrast list) and the public site (CSS variables), so the
 * three can never disagree about what a theme looks like or whether it passes.
 */

/** `#rgb` or `#rrggbb`, any case, normalised to lowercase `#rrggbb`. */
export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex colour such as #57ab4b.')
  .transform((value) => {
    const hex = value.slice(1).toLowerCase();
    return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`;
  });

export type SiteTheme = {
  primary: string;
  accent: string;
  background: string;
  text: string;
  dark: string;
};

const WHITE = '#ffffff';
const BLACK = '#000000';
/** WCAG 2.x AA for normal-size text. */
export const THEME_MIN_CONTRAST = 4.5;

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Per-channel sRGB mix: `a * weightA + b * (1 - weightA)`. */
export function mixHex(a: string, b: string, weightA: number): string {
  const ca = channels(a);
  const cb = channels(b);
  return `#${ca
    .map((v, i) => Math.round(v * weightA + cb[i]! * (1 - weightA)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const scale = (
  prefix: string,
  base: string,
  other: string,
  steps: Record<number, number>,
): [string, string][] =>
  Object.entries(steps).map(([step, weight]) => [
    `--color-${prefix}-${step}`,
    mixHex(base, other, weight),
  ]);

/** Every marketing palette variable the theme controls, as literal hex. */
export function deriveThemePalette(t: SiteTheme): Record<string, string> {
  return Object.fromEntries([
    ...scale('leaf', t.primary, WHITE, { 100: 0.1, 200: 0.2, 300: 0.4, 400: 0.85, 500: 1 }),
    ...scale('leaf', t.primary, BLACK, { 600: 0.82, 700: 0.68 }),
    ...scale('pine', t.primary, BLACK, { 600: 0.55, 700: 0.45, 800: 0.36, 900: 0.28, 950: 0.2 }),
    ...scale('sage', t.primary, t.background, {
      100: 0.06,
      200: 0.12,
      300: 0.16,
      400: 0.3,
      500: 0.5,
    }),
    ...scale('sage', t.primary, t.text, { 600: 0.35, 700: 0.25 }),
    ...scale('gold', t.accent, WHITE, { 100: 0.25, 300: 0.7, 400: 0.85, 500: 1 }),
    ...scale('gold', t.accent, BLACK, { 600: 0.88 }),
    ...scale('cream', t.background, t.background, { 50: 1 }),
    ...scale('cream', t.text, t.background, { 100: 0.02, 200: 0.07, 300: 0.12, 400: 0.18 }),
    ...scale('ink', t.text, BLACK, { 800: 1, 900: 0.75 }),
    ...scale('ink', t.text, t.background, { 400: 0.5, 500: 0.66, 600: 0.78, 700: 0.9 }),
    ...scale('navy', t.dark, BLACK, { 900: 1, 950: 0.75 }),
    ...scale('navy', t.dark, WHITE, {
      100: 0.06,
      200: 0.14,
      300: 0.25,
      400: 0.38,
      500: 0.52,
      600: 0.66,
      700: 0.78,
      800: 0.88,
    }),
  ]);
}

/** Text/background pairs the site actually renders; each must meet AA. */
export function themeContrastPairs(t: SiteTheme): { pair: string; ratio: number }[] {
  const p = deriveThemePalette(t);
  return [
    ['Text on background', t.text, t.background],
    ['Muted text on background', p['--color-ink-500']!, t.background],
    ['Background on dark sections', t.background, t.dark],
    ['Background on primary buttons', t.background, p['--color-pine-800']!],
    ['Text on accent', t.text, t.accent],
  ].map(([pair, a, b]) => ({ pair: pair!, ratio: contrastRatio(a!, b!) }));
}

export const themeContrastIssues = (t: SiteTheme) =>
  themeContrastPairs(t).filter((p) => p.ratio < THEME_MIN_CONTRAST);

/** Five well-formed colours, contrast not yet checked (lets an editor hold a failing draft). */
export const SiteThemeShapeSchema = z
  .object({
    primary: hexColorSchema,
    accent: hexColorSchema,
    background: hexColorSchema,
    text: hexColorSchema,
    dark: hexColorSchema,
  })
  .strict();

export const SiteThemeSchema = SiteThemeShapeSchema.superRefine((theme, ctx) => {
  for (const issue of themeContrastIssues(theme))
    ctx.addIssue({
      code: 'custom',
      message: `${issue.pair} contrast is ${issue.ratio.toFixed(2)}:1; it must be at least ${THEME_MIN_CONTRAST}:1.`,
    });
});

export const DEFAULT_SITE_THEME: SiteTheme = {
  primary: '#57ab4b',
  accent: '#fbc75e',
  background: '#fcfbf8',
  text: '#242b26',
  dark: '#1f2b52',
};

export const SITE_THEME_PRESETS: { name: string; theme: SiteTheme }[] = [
  { name: 'AF Homes default', theme: DEFAULT_SITE_THEME },
  {
    name: 'Forest',
    theme: {
      primary: '#3f8f4a',
      accent: '#e9b949',
      background: '#f7f8f3',
      text: '#1e2a20',
      dark: '#17301f',
    },
  },
  {
    name: 'Coastal',
    theme: {
      primary: '#2f8f9d',
      accent: '#f2b84b',
      background: '#f8fbfc',
      text: '#1b2a33',
      dark: '#16324a',
    },
  },
  {
    name: 'Earth',
    theme: {
      primary: '#8a6b3f',
      accent: '#d9a441',
      background: '#fbf8f2',
      text: '#2b241c',
      dark: '#3b2a1e',
    },
  },
];
