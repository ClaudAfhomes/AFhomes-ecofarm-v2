import { z } from 'zod';

import {
  policySchema,
  type Policy,
  type PolicyCreateRequest,
  type PolicyUpdateRequest,
} from '@jad/contracts';

import { request, requestList } from '../../../lib/api/client';

const deleteResponseSchema = z.object({
  id: z.string().min(1),
  deleted: z.boolean(),
  fileRemoved: z.boolean().optional(),
});

export type CreatePolicyInput = {
  title: string;
  slug: string;
  type: string;
  content?: string;
  documentUrl: string;
};

/** GET /policies - full published list (public endpoint, admin shell reuse). */
export function getPolicies(): Promise<Policy[]> {
  return requestList('/policies', policySchema);
}

/** POST /policies - publish a policy with its required PDF (super_admin + admin). */
export function createPolicy(input: CreatePolicyInput): Promise<Policy> {
  const body: PolicyCreateRequest = {
    title: input.title,
    slug: input.slug,
    type: input.type,
    ...(input.content !== undefined && { content: input.content }),
    documentUrl: input.documentUrl,
  };
  return request('/policies', policySchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** PUT /policies/:id - update fields and/or swap the PDF. */
export function updatePolicy(id: string, patch: PolicyUpdateRequest): Promise<Policy> {
  return request(`/policies/${id}`, policySchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/**
 * DELETE /policies/:id - permanently remove a policy. The stored PDF object
 * is removed from `marketing-tools` best-effort (`fileRemoved` reports the
 * outcome; a storage failure never blocks the delete). Irreversible -
 * callers confirm first.
 */
export function deletePolicy(
  id: string,
): Promise<{ id: string; deleted: boolean; fileRemoved?: boolean }> {
  return request(`/policies/${id}`, deleteResponseSchema, { method: 'DELETE' });
}
