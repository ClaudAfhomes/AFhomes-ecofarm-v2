import { adminQueuesSchema, type AdminQueues } from '@jad/contracts';

import { request } from '../../../lib/api/client';

/**
 * Admin dashboard queue counts (UI-UX §4.1). Server facts - never derived
 * client-side. PROPOSED endpoint; F0 serves mock data.
 */
export function getAdminQueues(): Promise<AdminQueues> {
  return request('/admin/queues', adminQueuesSchema);
}
