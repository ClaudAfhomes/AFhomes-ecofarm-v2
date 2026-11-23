/**
 * Phase 28 - safe-URL boundary for CMS-controlled content.
 *
 * A hostile or mistaken CMS editor must never get an executable or
 * exfiltrating URL into public markup. These tests pin the allowlist from
 * both directions: every safe shape from the repository content stays
 * linkable, and every attacker shape (mixed case, padded, control-character
 * smuggled) resolves to null.
 */
import { describe, expect, it } from 'vitest';

import { safeHref, safeSrc } from './safeUrl';

describe('safeHref', () => {
  it('allows the destinations the repository content actually uses', () => {
    expect(safeHref('https://maps.app.goo.gl/mJqoxkhNU1cMxu6LA')).toBe(
      'https://maps.app.goo.gl/mJqoxkhNU1cMxu6LA',
    );
    expect(safeHref('https://www.facebook.com/afhomes')).toBe('https://www.facebook.com/afhomes');
    expect(safeHref('http://example.com/page')).toBe('http://example.com/page');
    expect(safeHref('/experiences/hotspring')).toBe('/experiences/hotspring');
    expect(safeHref('#booking')).toBe('#booking');
    expect(safeHref('mailto:stay@afhomes.example')).toBe('mailto:stay@afhomes.example');
    expect(safeHref('tel:+639171234567')).toBe('tel:+639171234567');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    'javascript:alert(1) ',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'DATA:text/html,hi',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/uuid',
  ])('rejects %s', (value) => {
    expect(safeHref(value)).toBeNull();
  });

  it('rejects non-strings, empties, and overlong values', () => {
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref(42)).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref('   ')).toBeNull();
    expect(safeHref(`https://example.com/${'x'.repeat(2000)}`)).toBeNull();
  });
});

describe('safeSrc', () => {
  it('allows remote and site-relative media sources', () => {
    expect(safeSrc('https://cdn.example/img.jpg')).toBe('https://cdn.example/img.jpg');
    expect(safeSrc('http://cdn.example/v.mp4')).toBe('http://cdn.example/v.mp4');
    expect(safeSrc('/assets/hero.webp')).toBe('/assets/hero.webp');
  });

  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'vbscript:x',
    'mailto:a@b.c',
    '#fragment',
    '',
  ])('rejects %s as a media source', (value) => {
    expect(safeSrc(value)).toBeNull();
  });
});
