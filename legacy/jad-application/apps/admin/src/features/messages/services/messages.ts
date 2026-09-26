import {
  adminConversationSchema,
  adminMessagesSummarySchema,
  messageSchema,
  markMessagesReadResponseSchema,
} from '@jad/contracts';
import type {
  AdminConversation,
  AdminMessagesSummary,
  CreateMessageRequest,
  MarkMessagesReadResponse,
  Message,
} from '@jad/contracts';

import { request, requestList, requestPage } from '../../../lib/api/client';
import type { PageResult } from '../../../lib/api/client';

/**
 * Admin messaging services (FEAT-072, ADR-013) - typed wrappers over the API
 * client for the member-conversation inbox and per-member threads. All
 * endpoints are module-gated `messages` server-side (super_admin/admin).
 */

/** `GET /admin/conversations` - inbox: one row per member with a thread. */
export function getAdminConversations(): Promise<AdminConversation[]> {
  return requestList('/admin/conversations', adminConversationSchema);
}

/** `GET /admin/conversations/:memberId?cursor=…` - one member's thread (newest first). */
export function getConversationThread(
  memberId: string,
  cursor?: string,
  limit?: number,
): Promise<PageResult<Message>> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return requestPage(`/admin/conversations/${memberId}${query}`, messageSchema);
}

/** `POST /admin/conversations/:memberId/messages` - staff reply (audited). */
export function sendStaffMessage(memberId: string, input: CreateMessageRequest): Promise<Message> {
  return request(`/admin/conversations/${memberId}/messages`, messageSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `POST /admin/conversations/:memberId/read` - staff read watermark. */
export function markConversationRead(memberId: string): Promise<MarkMessagesReadResponse> {
  return request(`/admin/conversations/${memberId}/read`, markMessagesReadResponseSchema, {
    method: 'POST',
  });
}

/** `GET /admin/messages/summary` - inbox badge (unread member messages). */
export function getAdminMessagesSummary(): Promise<AdminMessagesSummary> {
  return request('/admin/messages/summary', adminMessagesSummarySchema);
}
