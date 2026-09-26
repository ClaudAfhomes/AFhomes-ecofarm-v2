import { notificationSchema, type CreateBroadcastRequest, type Notification } from '@jad/contracts';

import { request, requestList } from '../../../lib/api/client';

export type CreateBroadcastInput = {
  title: string;
  body?: string;
};

/** GET /admin/broadcasts - every broadcast announcement, newest first (SCR-ADM-016). */
export function getAdminBroadcasts(): Promise<Notification[]> {
  return requestList('/admin/broadcasts', notificationSchema);
}

/** POST /broadcasts - announce to all members (FEAT-063, FR-ADM-005). */
export function createBroadcast(input: CreateBroadcastInput): Promise<Notification> {
  const body: CreateBroadcastRequest = {
    title: input.title,
    ...(input.body !== undefined && { body: input.body }),
  };
  return request('/broadcasts', notificationSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
