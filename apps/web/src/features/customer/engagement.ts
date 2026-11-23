/**
 * Member engagement calls and hooks: notifications, bookings, messages and
 * announcements. Thin wrappers over the typed client; every rule (who may book,
 * what is cancellable, who may read a thread) is enforced by the server.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  announcementFeedItemSchema,
  bookableServiceSchema,
  bookingSchema,
  conversationDetailSchema,
  conversationMessageSchema,
  conversationSchema,
  customerNotificationSchema,
  type CreateBooking,
  type PostMessage,
  type StartConversation,
} from '@afhomes/contracts';
import { z } from 'zod';

import { request, requestList } from '../../lib/api/client';

const notificationsResponseSchema = z.object({
  data: z.array(customerNotificationSchema),
  meta: z.object({ unreadCount: z.number().int().nonnegative() }),
});
const okSchema = z.object({ ok: z.literal(true) });

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const getNotifications = () =>
  request('/portal/notifications', notificationsResponseSchema);
export const markNotificationsRead = (body: { ids: string[] } | { all: true }) =>
  request('/portal/notifications/read', okSchema, post(body));
export const getAnnouncements = () =>
  requestList('/portal/announcements', announcementFeedItemSchema);
export const getServices = () => requestList('/portal/services', bookableServiceSchema);
export const getBookings = () => requestList('/portal/bookings', bookingSchema);
export const createBooking = (body: CreateBooking) =>
  request('/portal/bookings', bookingSchema, post(body));
export const cancelBooking = (id: string) =>
  request(`/portal/bookings/${id}/cancel`, bookingSchema, { method: 'POST' });
export const getConversations = () => requestList('/portal/conversations', conversationSchema);
export const getConversation = (id: string) =>
  request(`/portal/conversations/${id}`, conversationDetailSchema);
export const startConversation = (body: StartConversation) =>
  request('/portal/conversations', conversationSchema, post(body));
export const postConversationMessage = (id: string, body: PostMessage) =>
  request(`/portal/conversations/${id}/messages`, conversationMessageSchema, post(body));

const KEY = ['customer', 'engagement'] as const;

export const useNotificationsQuery = () =>
  useQuery({ queryKey: [...KEY, 'notifications'], queryFn: getNotifications, refetchInterval: 30_000 });

export const useMarkNotificationsRead = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: () => client.invalidateQueries({ queryKey: [...KEY, 'notifications'] }),
  });
};

export const useAnnouncementsQuery = () =>
  useQuery({ queryKey: [...KEY, 'announcements'], queryFn: getAnnouncements, refetchInterval: 30_000 });

export const useServicesQuery = () =>
  useQuery({ queryKey: [...KEY, 'services'], queryFn: getServices });

export const useBookingsQuery = () =>
  useQuery({ queryKey: [...KEY, 'bookings'], queryFn: getBookings, refetchInterval: 30_000 });

export const useCreateBooking = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createBooking,
    onSuccess: () => client.invalidateQueries({ queryKey: [...KEY, 'bookings'] }),
  });
};

export const useCancelBooking = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: cancelBooking,
    // A 409 means staff already decided; refresh so the list shows the truth.
    onSettled: () => client.invalidateQueries({ queryKey: [...KEY, 'bookings'] }),
  });
};

export const useConversationsQuery = () =>
  useQuery({
    queryKey: [...KEY, 'conversations'],
    queryFn: getConversations,
    refetchInterval: 30_000,
  });

export const useConversationQuery = (id: string | null) =>
  useQuery({
    queryKey: [...KEY, 'conversation', id],
    queryFn: () => getConversation(id as string),
    enabled: id !== null,
    refetchInterval: 15_000,
  });

export const useStartConversation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: startConversation,
    onSuccess: () => client.invalidateQueries({ queryKey: [...KEY, 'conversations'] }),
  });
};

export const usePostMessage = (id: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PostMessage) => postConversationMessage(id, body),
    onSuccess: () => client.invalidateQueries({ queryKey: [...KEY] }),
  });
};
