import { memberAccountSchema, type MemberAccount } from '@jad/contracts';

import { requestList } from '../../../lib/api/client';

/**
 * Registrations queue (SCR-ADM-001/verification workflow). PROPOSED endpoint -
 * F0 serves mock data through the API-shaped mock server.
 */
export function getRegistrations(): Promise<MemberAccount[]> {
  return requestList('/admin/registrations', memberAccountSchema);
}
