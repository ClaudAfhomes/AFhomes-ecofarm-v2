/**
 * Public property route helpers. Clean, readable URL structure:
 *
 *   /properties
 *   /properties/:categorySlug
 *   /properties/:categorySlug/:propertySlug
 *
 * Centralized so slugs are never assembled by hand in components/tests.
 */

/** Root of the properties browsing experience. */
export const PROPERTIES_PATH = '/properties';

/** `/properties/{categorySlug}` */
export function categoryPath(categorySlug: string): string {
  return `${PROPERTIES_PATH}/${categorySlug}`;
}

/** `/properties/{categorySlug}/{propertySlug}` */
export function propertyPath(categorySlug: string, propertySlug: string): string {
  return `${PROPERTIES_PATH}/${categorySlug}/${propertySlug}`;
}
