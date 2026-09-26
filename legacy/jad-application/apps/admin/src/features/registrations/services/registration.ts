import { memberAccountSchema, type MemberAccount } from '@jad/contracts';

import { request } from '../../../lib/api/client';

/**
 * Fetch a single registration/member account by ID.
 * PROPOSED endpoint - F0 uses mock data.
 */
export function getRegistration(id: string): Promise<MemberAccount> {
  return request(`/admin/registrations/${id}`, memberAccountSchema);
}
