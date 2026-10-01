/**
 * Cross-portal identity probe for the staff console.
 *
 * `GET /auth/portals` resolves the bearer's own staff/customer/OST rows.
 * Login screens route on it; it authorizes nothing.
 */
import { authPortalsSchema, type AuthPortals } from '@jad/contracts';

import { protectedRequest } from './api/client';

export const getAuthPortals = (): Promise<AuthPortals> =>
  protectedRequest('/auth/portals', authPortalsSchema);

export type { AuthPortals };
