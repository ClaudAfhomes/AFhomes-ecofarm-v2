import { createMockServer } from '@jad/mock';

import { memberMockHandlers } from './handlers';
import { createMockStore } from './store';

export { createMockStore, DEMO_PASSWORD } from './store';
export type { MockStore } from './store';

/**
 * F1 dev mock for the member app: fresh in-memory store + API-shaped handlers.
 * Installed in dev only (`apps/web/src/main.tsx`); replaced by the real API.
 */
export function createMemberMockServer() {
  const store = createMockStore();
  return createMockServer(memberMockHandlers(store));
}
