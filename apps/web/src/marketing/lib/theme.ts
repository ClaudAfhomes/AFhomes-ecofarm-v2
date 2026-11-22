import type { CSSProperties } from 'react';
import { SiteThemeSchema, deriveThemePalette } from '@afhomes/contracts';

/**
 * Semantic aliases from marketing.css that point at themed palette steps.
 * `@theme` declares them on `:root`, where `var()` resolves against the default
 * palette, so overriding only the palette below `.afh-public` would leave them
 * frozen. Each is re-emitted with its derived value. Keep in step with the
 * "SEMANTIC ALIASES" block in marketing.css; aliases of unthemed colours
 * (coral, cyan, magenta, line) are deliberately absent.
 */
const ALIASES: Record<string, string> = {
  '--color-primary': '--color-leaf-500',
  '--color-primary-dark': '--color-pine-800',
  '--color-primary-light': '--color-leaf-300',
  '--color-primary-ink': '--color-pine-900',
  '--color-navy-brand': '--color-navy-800',
  '--color-gold-brand': '--color-gold-500',
  '--color-background': '--color-cream-50',
  '--color-surface': '--color-cream-100',
  '--color-surface-muted': '--color-cream-200',
  '--color-surface-sage': '--color-sage-300',
  '--color-charcoal': '--color-ink-900',
  '--color-muted-green': '--color-sage-600',
  '--color-text': '--color-ink-900',
  '--color-text-muted': '--color-ink-500',
};

/**
 * CSS variables for a published CMS theme, set on the `.afh-public` wrapper so
 * every Tailwind palette utility below it picks up the new colours. Anything
 * that is not a valid, readable theme yields `undefined`: the stylesheet's own
 * palette stays in force exactly as before.
 */
export function themeStyle(theme: unknown): CSSProperties | undefined {
  const parsed = SiteThemeSchema.safeParse(theme);
  if (!parsed.success) return undefined;
  const palette = deriveThemePalette(parsed.data);
  const aliases = Object.fromEntries(
    Object.entries(ALIASES).map(([alias, target]) => [alias, palette[target]!]),
  );
  return { ...palette, ...aliases } as CSSProperties;
}
