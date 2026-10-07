/**
 * AF Homes staff communications contracts (conversations, announcements,
 * notifications).
 *
 * Two rules shape every request schema here.
 *
 * 1. The client never asserts identity or authority. There is no `senderId`, no
 *    `recipientId`, no `roleSlug`, no `status`, no `createdAt` and no `readAt`
 *    on any mutation. The actor comes from the resolved session, the audience
 *    is resolved from role/department membership, and the clock is the
 *    server's. A tampered body has nothing to spoof with. Every mutation is
 *    `.strict()`, so a new field cannot appear without a deliberate edit here.
 *
 * 2. Status strings live ONLY in `lifecycle.ts`. A contract that spelled
 *    `published` itself would be a second source of truth that could drift.
 *
 * Content is plain text. Message and announcement bodies are never case-folded
 * (a name is uppercase because the repo stores names uppercase; prose is not
 * transformed) and are never rendered as HTML - the API returns a string and
 * the client decides how to display it.
 *
 * Cursor pagination: `{ v, conversationId, createdAt, id }` base64url-encoded
 * JSON. The conversation id is INSIDE the payload and re-checked on decode, so
 * a cursor minted for one conversation cannot be replayed against another.
 */
import { z } from 'zod';

import { announcementStatusSchema } from './lifecycle.js';

/* ------------------------------------------------------------------ */
/* Participants and recipients                                        */
/* ------------------------------------------------------------------ */

/**
 * A staff member the caller may address. Deliberately minimal: it carries the
 * display fields the composer needs and nothing that could be replayed into a
 * mutation (no email, no department, no status history).
 */
export const communicationRecipientSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  roleSlug: z.string(),
});
export type CommunicationRecipient = z.infer<typeof communicationRecipientSchema>;

/** A member of a conversation, as the conversation screen shows them. */
export const communicationParticipantSchema = z.object({
  staffId: z.string().uuid(),
  fullName: z.string(),
  roleSlug: z.string(),
  /** True when this member may manage the group (add/remove/archive). */
  isManager: z.boolean(),
  /** False for a participant whose staff account is inactive or suspended. */
  active: z.boolean(),
});
export type CommunicationParticipant = z.infer<typeof communicationParticipantSchema>;

/* ------------------------------------------------------------------ */
/* Messages                                                           */
/* ------------------------------------------------------------------ */

export const communicationMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  /**
   * Per-conversation monotonic sequence. Authorization is an append-only
   * membership-interval model keyed on this, so it is part of the wire shape
   * and never a display-only counter.
   */
  sequence: z.number().int().positive(),
  senderId: z.string().uuid(),
  senderFullName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type CommunicationMessage = z.infer<typeof communicationMessageSchema>;

export const communicationMessagePageSchema = z.object({
  data: z.array(communicationMessageSchema),
  meta: z.object({
    /** Null on the last page. Required, never defaulted, so a client cannot
     *  mistake "no meta" for "no more pages". */
    nextCursor: z.string().nullable(),
  }),
});
export type CommunicationMessagePage = z.infer<typeof communicationMessagePageSchema>;

/**
 * A conversation in the caller's list.
 *
 * `historicalOnly` is the read-only mode flag: true when the caller's ONLY
 * membership interval is closed, meaning they were removed or the group was
 * archived out from under them. They may still read what they were authorized
 * to read while they were a member, and the UI must not offer send, add member
 * or archive. It is derived server-side from the interval rows; a client
 * cannot assert it.
 */
export const communicationConversationSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['direct', 'group']),
  title: z.string().nullable(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(),
  lastMessageAt: z.string().nullable(),
  lastMessagePreview: z.string().nullable(),
  historicalOnly: z.boolean(),
});
export type CommunicationConversation = z.infer<typeof communicationConversationSchema>;

/* ------------------------------------------------------------------ */
/* Announcements                                                      */
/* ------------------------------------------------------------------ */

/**
 * An announcement as the READER sees it. It carries no audience row id and no
 * recipient list: a reader learns that an announcement reached them, never
 * which targeting rule selected them or who else received it. Management
 * figures stay on the Admin endpoint.
 */
export const communicationAnnouncementSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  status: announcementStatusSchema,
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  /** Per-reader read state, not a document column. */
  readAt: z.string().nullable(),
});
export type CommunicationAnnouncement = z.infer<typeof communicationAnnouncementSchema>;

/**
 * Who an announcement is addressed to. A discriminated union with exactly ONE
 * arm, so "everyone plus one department" cannot be smuggled in as one row and
 * there is no field on which to hang a second targeting rule. The rows are
 * resolved to concrete recipients ON PUBLISH and frozen; editing the draft
 * audience afterwards never rewrites who already received it.
 */
export const audienceInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all_staff') }).strict(),
  z.object({ kind: z.literal('role'), roleSlug: z.string().trim().min(1).max(80) }).strict(),
  z.object({ kind: z.literal('department'), departmentId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('staff'), staffId: z.string().uuid() }).strict(),
]);
export type AudienceInput = z.infer<typeof audienceInputSchema>;

/* ------------------------------------------------------------------ */
/* Notifications                                                      */
/* ------------------------------------------------------------------ */

export const NOTIFICATION_TYPES = [
  'message',
  'announcement',
  'group_invitation',
  'group_removal',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string(),
  summary: z.string(),
  /**
   * The record the bell links to. `entityId` is a navigation target only:
   * clicking it re-resolves through the authorized endpoint, so the id alone
   * authorizes nothing.
   */
  entityType: z.enum(['conversation', 'announcement']),
  entityId: z.string().uuid(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const unreadCountSchema = z.object({
  unread: z.number().int().nonnegative(),
});
export type UnreadCount = z.infer<typeof unreadCountSchema>;

/* ------------------------------------------------------------------ */
/* Mutation requests (every one strict)                               */
/* ------------------------------------------------------------------ */

export const createMessageRequestSchema = z
  .object({
    /**
     * Trimmed then bounded: a body of `'  ok  '` stores `'ok'`, so padding
     * cannot smuggle an "empty-looking" message past the minimum or inflate
     * the stored length. Prose is never case-folded or otherwise rewritten.
     */
    body: z.string().trim().min(1).max(4000),
    /** Caller-generated de-duplication id, retained across a retry so the
     *  same send is never recorded twice. */
    requestId: z.string().uuid(),
  })
  .strict();
export type CreateMessageRequest = z.infer<typeof createMessageRequestSchema>;

/**
 * The client reports the LAST message it rendered, not an arbitrary instant:
 * the server marks read up to that sequence inside the caller's membership
 * interval, so a stale or foreign id cannot mark a message read.
 */
export const markConversationReadRequestSchema = z
  .object({
    messageId: z.string().uuid(),
  })
  .strict();
export type MarkConversationReadRequest = z.infer<typeof markConversationReadRequestSchema>;

/** Cap on one announcement's targeting rules; a broadcast is `all_staff`.
 *  Declared before the schema that consumes it. */
export const ANNOUNCEMENT_MAX_AUDIENCES = 50;

export const announcementDraftRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10000),
    /** Bounded at BOTH ends: an empty audience list is a draft that reaches
     *  nobody, and an unbounded one turns one draft into a per-staff fan-out
     *  the request validator cannot see coming. */
    audiences: z.array(audienceInputSchema).min(1).max(ANNOUNCEMENT_MAX_AUDIENCES),
  })
  .strict();
export type AnnouncementDraftRequest = z.infer<typeof announcementDraftRequestSchema>;

export const createConversationRequestSchema = z
  .object({
    kind: z.enum(['direct', 'group']),
    /** Display-only, and REQUIRED for a group: a nameless group is
     *  unmanageable in the list. A direct conversation omits it and derives
     *  its title from the participants server-side. */
    title: z.string().trim().max(200).optional(),
    /** The creator is added by the server and is NOT in this list. A direct
     *  conversation is exactly one other participant; a group is 1..49. */
    participantIds: z.array(z.string().uuid()).min(1).max(49),
    requestId: z.string().uuid(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // A direct conversation is the creator plus ONE other person. The array
    // bound alone would let `kind: 'direct'` smuggle in a whole roster, which
    // would then be created without a title and without group management.
    if (value.kind === 'direct' && value.participantIds.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['participantIds'],
        message: 'A direct conversation has exactly one other participant',
      });
    }
    if (value.kind === 'group' && !value.title) {
      ctx.addIssue({
        code: 'custom',
        path: ['title'],
        message: 'Name the group',
      });
    }
  });
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

/**
 * Adding a member names one staff id. Scope eligibility (may the acting
 * manager actually reach this person?) is decided server-side; `isManager` is
 * never client-assertable, so a client cannot promote itself.
 */
export const addMemberRequestSchema = z
  .object({
    staffId: z.string().uuid(),
  })
  .strict();
export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>;

/* ------------------------------------------------------------------ */
/* Message cursor codec                                               */
/* ------------------------------------------------------------------ */

/**
 * Strict: a cursor carrying a key this codec does not understand is REJECTED,
 * not silently stripped. Stripping would mean the payload asserted something
 * the decoder ignored, which is exactly the shape of a smuggled field.
 */
export const messageCursorSchema = z
  .object({
    v: z.literal(1),
    conversationId: z.string().uuid(),
    createdAt: z.string(),
    id: z.string().uuid(),
  })
  .strict();
export type MessageCursor = z.infer<typeof messageCursorSchema>;

/**
 * base64url, no padding, so a cursor is URL-safe as-is.
 *
 * `btoa`/`atob` + `TextEncoder`/`TextDecoder` rather than `Buffer`: this
 * workspace compiles with `types: []` (no Node types), and the primitives are
 * globals in both the browser and Node, so one implementation serves both.
 */
function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeMessageCursor(cursor: MessageCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

/**
 * Decode and re-validate. Throws on anything unrecognised, on a version other
 * than 1, and on a cursor minted for a DIFFERENT conversation.
 *
 * `expectedConversationId` is REQUIRED, and the comparison is unconditional.
 * It was optional once, which meant a handler that simply forgot to pass it
 * would happily accept a cursor from another conversation and page through
 * messages the caller is not a member of - a cross-conversation read. Making
 * the parameter mandatory turns that omission into a compile error, and the
 * conversation id travelling inside the payload is what makes the check
 * possible at all.
 */
export function decodeMessageCursor(cursor: string, expectedConversationId: string): MessageCursor {
  const parsed = messageCursorSchema.safeParse(decodeCursorJson(cursor));
  if (!parsed.success) throw new Error('Malformed message cursor');
  if (parsed.data.v !== 1) throw new Error('Unsupported message cursor version');
  if (parsed.data.conversationId !== expectedConversationId) {
    throw new Error('Message cursor belongs to a different conversation');
  }
  return parsed.data;
}

function decodeCursorJson(cursor: string): unknown {
  let json: string;
  try {
    json = fromBase64Url(cursor);
  } catch {
    throw new Error('Malformed message cursor');
  }
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new Error('Malformed message cursor');
  }
}
