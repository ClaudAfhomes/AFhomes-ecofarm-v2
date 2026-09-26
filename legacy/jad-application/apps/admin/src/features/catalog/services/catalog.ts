import {
  catalogPropertySchema,
  type CatalogProperty,
  type CatalogPropertyStatus,
  type CmsPropertyCategory,
  type CreatePropertyRequest,
  type UpdatePropertyRequest,
} from '@jad/contracts';
import { z } from 'zod';

import { request, requestList } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';

export type PropertyCategory = CmsPropertyCategory & {
  /** Number of listings referencing this category (derived server-side). */
  listingCount: number;
};

export type CreatePropertyInput = {
  name: string;
  categoryId: string;
  price?: string;
  status: CatalogPropertyStatus;
};

export type UpdatePropertyInput = {
  name?: string;
  categoryId?: string;
  price?: string | null;
  status?: CatalogPropertyStatus;
};

export type CreateCategoryInput = {
  slug: string;
  title: string;
  shortDescription: string;
  description: string;
  image: { id: string; alt: string };
  isFeatured?: boolean;
};

export type UpdateCategoryInput = {
  title?: string;
  shortDescription?: string;
  description?: string;
  image?: { id: string; alt: string };
  isFeatured?: boolean;
};

/** Property catalog item - transactional system-of-record (ID, category, price, status). */
export const propertySchema = catalogPropertySchema;

export type Property = CatalogProperty;

export type CategoryDeleteResult = { ok: boolean; reason?: string };

const categorySchema = z.object({
  slug: z.string(),
  title: z.string(),
  shortDescription: z.string(),
  description: z.string(),
  image: z.object({ id: z.string(), alt: z.string() }).passthrough(),
  isFeatured: z.boolean(),
  listingCount: z.number(),
});

const deleteResultSchema = z.object({ id: z.string(), deleted: z.boolean() });

/**
 * Catalog service - pure API calls, no mock fallback. The backend is the
 * system of record; failures surface to the caller instead of substituting
 * mock data.
 */

/** Fetch all properties. */
export function getProperties(): Promise<Property[]> {
  return requestList('/admin/properties', propertySchema);
}

/** Fetch a single property by ID. */
export function getProperty(id: string): Promise<Property> {
  return request(`/admin/properties/${id}`, propertySchema);
}

/** Create a property (id is server-generated). */
export function createProperty(input: CreatePropertyInput): Promise<Property> {
  const body: CreatePropertyRequest = {
    name: input.name,
    categoryId: input.categoryId,
    ...(input.price !== undefined && { price: input.price }),
    status: input.status,
  };
  return request('/admin/properties', propertySchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Update a property. */
export function updateProperty(id: string, input: UpdatePropertyInput): Promise<Property> {
  const body: UpdatePropertyRequest = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
    ...(input.price !== undefined && { price: input.price ?? undefined }),
    ...(input.status !== undefined && { status: input.status }),
  };
  return request(`/admin/properties/${id}`, propertySchema, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Delete a property. */
export async function deleteProperty(id: string): Promise<boolean> {
  await request(`/admin/properties/${id}`, deleteResultSchema, { method: 'DELETE' });
  return true;
}

/** Fetch all categories (merged key + presentation + counts). */
export async function getCategories(): Promise<PropertyCategory[]> {
  const live = await requestList('/admin/property-categories', categorySchema);
  return live as PropertyCategory[];
}

/** Create a category (key + presentation). */
export async function createCategory(input: CreateCategoryInput): Promise<PropertyCategory> {
  const live = await request('/admin/property-categories', categorySchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return live as PropertyCategory;
}

/** Update a category. */
export async function updateCategory(
  slug: string,
  input: UpdateCategoryInput,
): Promise<PropertyCategory> {
  const live = await request(`/admin/property-categories/${slug}`, categorySchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return live as PropertyCategory;
}

/** Delete a category (blocked while listings reference it). */
export async function deleteCategory(slug: string): Promise<CategoryDeleteResult> {
  try {
    await request(`/admin/property-categories/${slug}`, deleteResultSchema, { method: 'DELETE' });
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      return { ok: false, reason: 'Cannot delete category with existing listings.' };
    }
    throw e;
  }
}
