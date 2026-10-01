/**
 * Cross-portal identity probe for the public app.
 *
 * `GET /auth/portals` resolves the bearer's own staff/customer/OST rows.
 * Login screens route on it; it authorizes nothing.
 */
import { authPortalsSchema, type AuthPortals } from '@jad/contracts';

import { request } from './api/client';

export const getAuthPortals = (): Promise<AuthPortals> => request('/auth/portals', authPortalsSchema);

export type { AuthPortals };
