import type { CatalogProperty, CmsProperty, CmsPropertyCategory } from '@jad/contracts';

import type { PropertyCategory } from '../../catalog/services/catalog';

/**
 * Link-by-reference resolution between CMS entries and the catalog
 * system-of-record (read-time only - resolving never writes anything).
 *
 * Precedence per entry: an explicit link (`catalogId` / `catalogSlug`) wins;
 * otherwise the entry auto-matches when its own id/slug equals a catalog
 * id/slug; otherwise it is unlinked. An explicit link pointing at a missing
 * catalog row is dangling (warning, never blocks saving).
 */
export type CatalogLink<T> =
  | { kind: 'explicit' | 'auto'; target: T }
  | { kind: 'dangling'; missing: string }
  | { kind: 'none' };

export function resolveListingLink<T extends Pick<CatalogProperty, 'id'>>(
  prop: Pick<CmsProperty, 'id' | 'catalogId'>,
  listings: readonly T[] | undefined,
): CatalogLink<T> {
  const rows = listings ?? [];
  if (prop.catalogId) {
    const target = rows.find((p) => p.id === prop.catalogId);
    return target ? { kind: 'explicit', target } : { kind: 'dangling', missing: prop.catalogId };
  }
  const auto = rows.find((p) => p.id === prop.id);
  return auto ? { kind: 'auto', target: auto } : { kind: 'none' };
}

export function resolveCategoryLink<T extends Pick<PropertyCategory, 'slug'>>(
  cat: Pick<CmsPropertyCategory, 'slug' | 'catalogSlug'>,
  categories: readonly T[] | undefined,
): CatalogLink<T> {
  const rows = categories ?? [];
  if (cat.catalogSlug) {
    const target = rows.find((c) => c.slug === cat.catalogSlug);
    return target ? { kind: 'explicit', target } : { kind: 'dangling', missing: cat.catalogSlug };
  }
  const auto = rows.find((c) => c.slug === cat.slug);
  return auto ? { kind: 'auto', target: auto } : { kind: 'none' };
}

/** Effective catalog listing ids referenced by CMS entries (explicit or auto). */
export function cmsLinkedListingIds<T extends Pick<CatalogProperty, 'id'>>(
  properties: readonly Pick<CmsProperty, 'id' | 'catalogId'>[] | undefined,
  listings: readonly T[] | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const prop of properties ?? []) {
    const resolved = resolveListingLink(prop, listings);
    if (resolved.kind === 'explicit' || resolved.kind === 'auto') ids.add(resolved.target.id);
  }
  return ids;
}

/** Effective catalog category slugs referenced by CMS entries (explicit or auto). */
export function cmsLinkedCategorySlugs<T extends Pick<PropertyCategory, 'slug'>>(
  categories: readonly Pick<CmsPropertyCategory, 'slug' | 'catalogSlug'>[] | undefined,
  catalogCategories: readonly T[] | undefined,
): Set<string> {
  const slugs = new Set<string>();
  for (const cat of categories ?? []) {
    const resolved = resolveCategoryLink(cat, catalogCategories);
    if (resolved.kind === 'explicit' || resolved.kind === 'auto') slugs.add(resolved.target.slug);
  }
  return slugs;
}
