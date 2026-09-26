import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Card-mode overflow regression (mobile ≤639px): value spans inside the
 * flex card cells must shrink (min-width: 0 + ellipsis) instead of forcing
 * their min-content width past the viewport. jsdom performs no layout, so
 * the contract is asserted against the stylesheet source.
 */
const css = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'ContentPage.module.css'),
  'utf8',
);
function mediaBlock(query: string): string {
  const start = css.indexOf(query);
  expect(start, `missing ${query}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  let end = start;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  return css.slice(start, end + 1);
}

describe('ContentPage responsive rules', () => {
  it('constrains card-mode values so long titles/descriptions cannot overflow', () => {
    const mobile = mediaBlock('@media (max-width: 639px)');
    expect(mobile).toContain('min-width: 0');
    expect(mobile).toContain('text-overflow: ellipsis');
    // Description drops its desktop 40ch cap inside cards.
    expect(mobile).toMatch(/\.description[\s\S]*max-width:\s*none/);
  });

  it('wraps the table footer instead of overflowing on phones', () => {
    const mobile = mediaBlock('@media (max-width: 639px)');
    expect(mobile).toMatch(/\.tableFooter[\s\S]*flex-wrap:\s*wrap/);
  });

  it('clamps the description column on tablet widths', () => {
    const tablet = mediaBlock('@media (min-width: 640px) and (max-width: 1023px)');
    expect(tablet).toContain('-webkit-line-clamp: 2');
  });
});
