import { z } from 'zod';

import { staffSessionSchema } from '@jad/contracts';
import type { ChangeStaffPasswordRequest, UpdateStaffProfileRequest } from '@jad/contracts';

import { request } from '../../../lib/api/client';

/** PATCH /admin/session - update own display name (My Account). */
export function updateStaffProfile(input: UpdateStaffProfileRequest) {
  return request('/admin/session', staffSessionSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

const changedSchema = z.object({ changed: z.boolean() });

/** POST /admin/session/password - change own password (current verified server-side). */
export function changeStaffPassword(input: ChangeStaffPasswordRequest) {
  return request('/admin/session/password', changedSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
