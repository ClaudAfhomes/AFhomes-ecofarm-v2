/**

 * Card-plan catalog API client.

 * 

 * Plans and categories served as card-products.

 */

import {
  cardCategorySchema,
  cardProductSchema,
  type CardCategory,
  type CardProduct,
  type CreateCardCategoryRequest,
  type CreateCardProductRequest,
  type UpdateCardCategoryRequest,
  type UpdateCardProductRequest,
} from '@afhomes/contracts';

import { z } from 'zod';

import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';
const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

const patch = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'PATCH', body: JSON.stringify(body) });

/* ------------------------------------------------------------------ */
/* Card plans (served as `card-products`; the route is stable)              */
/* ------------------------------------------------------------------ */

export type CardPlanVisibility = 'active' | 'inactive' | 'all';

export const getCardProducts = (
  params: { active?: CardPlanVisibility; search?: string } = {},
): Promise<CardProduct[]> => {
  const query = new URLSearchParams();
  if (params.active && params.active !== 'active') query.set('active', params.active);
  if (params.search) query.set('search', params.search);
  const suffix = query.toString();
  return requestList(`/card-products${suffix ? `?${suffix}` : ''}`, cardProductSchema);
};

export const getCardProduct = (id: string): Promise<CardProduct> =>
  request(`/card-products/${id}`, cardProductSchema);

export const createCardProduct = (input: CreateCardProductRequest): Promise<CardProduct> =>
  post('/card-products', cardProductSchema, input);

export const updateCardProduct = (
  id: string,
  input: UpdateCardProductRequest,
): Promise<CardProduct> => patch(`/card-products/${id}`, cardProductSchema, input);

/* ------------------------------------------------------------------ */
/* Card categories (the plan vocabulary; same permission family)        */
/* ------------------------------------------------------------------ */

export const getCardCategories = (
  params: { active?: CardPlanVisibility; search?: string } = {},
): Promise<CardCategory[]> => {
  const query = new URLSearchParams();
  if (params.active && params.active !== 'active') query.set('active', params.active);
  if (params.search) query.set('search', params.search);
  const suffix = query.toString();
  return requestList(`/card-categories${suffix ? `?${suffix}` : ''}`, cardCategorySchema);
};

export const createCardCategory = (input: CreateCardCategoryRequest): Promise<CardCategory> =>
  post('/card-categories', cardCategorySchema, input);

export const updateCardCategory = (
  id: string,
  input: UpdateCardCategoryRequest,
): Promise<CardCategory> => patch(`/card-categories/${id}`, cardCategorySchema, input);
