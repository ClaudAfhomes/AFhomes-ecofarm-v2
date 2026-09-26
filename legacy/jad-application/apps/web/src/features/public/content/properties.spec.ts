import { describe, expect, it } from 'vitest';

import { isExactDecimal } from '@jad/shared';

import {
  PROPERTY_CATEGORIES,
  PROPERTY_RECORDS,
  getCategoryBySlug,
  getFeaturedProperties,
  getPropertiesByCategory,
  getPropertyById,
  getRelatedProperties,
} from './properties';
import { categoryPath, propertyPath } from './routes';

describe('property catalog data integrity', () => {
  it('has unique category slugs and property ids', () => {
    const categorySlugs = PROPERTY_CATEGORIES.map((category) => category.slug);
    expect(new Set(categorySlugs).size).toBe(categorySlugs.length);

    const propertyIds = PROPERTY_RECORDS.map((property) => property.id);
    expect(new Set(propertyIds).size).toBe(propertyIds.length);
  });

  it('references only known categories and uses exact-decimal prices when published', () => {
    for (const property of PROPERTY_RECORDS) {
      expect(getCategoryBySlug(property.categoryId)).toBeDefined();
      if (property.price !== undefined) {
        expect(isExactDecimal(property.price)).toBe(true);
      }
      expect(property.gallery.length).toBeGreaterThan(0);
      expect(property.overview.length).toBeGreaterThan(0);
      expect(property.highlights.length).toBeGreaterThan(0);
    }
  });

  it('groups every property under its category without duplicating records', () => {
    const counts = PROPERTY_CATEGORIES.map(
      (category) => getPropertiesByCategory(category.slug).length,
    );
    expect(counts).toEqual([5, 3, 2]);

    // Every catalog property appears exactly once across all categories.
    const grouped = PROPERTY_CATEGORIES.flatMap((category) =>
      getPropertiesByCategory(category.slug),
    );
    expect(grouped).toHaveLength(PROPERTY_RECORDS.length);
    expect(new Set(grouped.map((property) => property.id)).size).toBe(PROPERTY_RECORDS.length);
  });

  it('returns featured properties one per category', () => {
    const featured = getFeaturedProperties();
    expect(featured).toHaveLength(PROPERTY_CATEGORIES.length);
    expect(new Set(featured.map((property) => property.categoryId)).size).toBe(
      PROPERTY_CATEGORIES.length,
    );
  });

  it('derives related properties excluding the current one', () => {
    const mountainView = getPropertyById('mountain-view-leisure-community')!;
    const related = getRelatedProperties(mountainView);
    expect(related).toHaveLength(3);
    expect(related.some((property) => property.id === 'mountain-view-leisure-community')).toBe(
      false,
    );

    const astra = getPropertyById('prisma-astra-1br')!;
    const astraRelated = getRelatedProperties(astra, 2);
    expect(astraRelated.every((property) => property.categoryId === astra.categoryId)).toBe(true);
  });

  it('builds the clean URL structure from slugs', () => {
    expect(categoryPath('tenanted-condo-resales')).toBe('/properties/tenanted-condo-resales');
    expect(propertyPath('tenanted-condo-resales', 'prisma-astra-1br')).toBe(
      '/properties/tenanted-condo-resales/prisma-astra-1br',
    );
  });
});
