/**
 * Phase 28 - safe-URL boundary for CMS-controlled content.
 *
 * Section content, social links, office map URLs and media sources all arrive
 * as CMS-authored (or fallback) strings and reach executable or remote-loading
 * contexts (`<a href>`, `<img src>`, `<video>/<source src>`). Rendering them
 * verbatim would let a hostile or mistaken editor inject `javascript:` links.
 * These helpers are the single allowlist both the public renderers use:
 *
 * - anchors: `http:`, `https:`, `mailto:`, `tel:`, site-relative (`/...`) and
 *   fragment (`#...`) destinations only;
 * - media: `http:`, `https:` and site-relative sources only.
 *
 * Anything else yields `null` so the caller degrades gracefully (skip the
 * element), never a clickable or loadable attacker string. Matching is
 * case-insensitive and whitespace/control-character tolerant, so
 * `  JaVaScRiPt:alert(1)` is rejected exactly like `javascript:alert(1)`.
 */

const HREF_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SRC_SCHEMES = new Set(['http:', 'https:']);

function schemeOf(value: string): string | null {
  const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(value);
  return match ? match[0]!.toLowerCase() : null;
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Strip ASCII control characters everywhere (a tab inside `java\tscript:`
  // is parsed as `javascript:` by browsers) and trim the ends. Interior
  // spaces are preserved: they can never form an allowlisted scheme.
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001F\u007F]+/g, '').trim();
  return text.length > 0 && text.length <= 2000 ? text : null;
}

/** Safe destination for `<a href>`, or null when the value must not be linked. */
export function safeHref(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  if (text.startsWith('/') || text.startsWith('#')) return text;
  const scheme = schemeOf(text);
  // `clean` already stripped control characters (including CR/LF), so a
  // `mailto:`/`tel:` recipient cannot smuggle a line break past this point.
  return scheme && HREF_SCHEMES.has(scheme) ? text : null;
}

/** Safe source for `<img src>` / `<video src>` / `<source src>`, or null. */
export function safeSrc(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  if (text.startsWith('/')) return text;
  const scheme = schemeOf(text);
  return scheme && SRC_SCHEMES.has(scheme) ? text : null;
}
