/**
 * Structural pins for the communications contracts.
 *
 * Two properties matter more than the field lists.
 *
 * 1. A request can never assert identity the server owns. There is no
 *    `senderId`, no `recipientId`, no `roleSlug`, no `status` and no timestamp
 *    on a mutation, so a tampered body has nothing to spoof with. The strict
 *    object makes that structural: an unknown key is an error, not a silent
 *    strip, so a future field cannot appear without a deliberate edit here.
 *
 * 2. Status strings live only in `lifecycle.ts`. A contract that spelled
 *    `draft` or `published` itself would be a second source of truth.
 */
import { describe, expect, it } from 'vitest';

import {
  announcementDraftRequestSchema,
  audienceInputSchema,
  communicationAnnouncementSchema,
  communicationConversationSchema,
  communicationMessagePageSchema,
  communicationMessageSchema,
  createConversationRequestSchema,
  createMessageRequestSchema,
  decodeMessageCursor,
  encodeMessageCursor,
  markConversationReadRequestSchema,
  messageCursorSchema,
  notificationSchema,
  addMemberRequestSchema,
  ANNOUNCEMENT_MAX_AUDIENCES,
} from './communications.js';
import { ANNOUNCEMENT_TRANSITIONS, announcementStatusSchema } from './lifecycle.js';

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';

/** base64url, matching what `encodeMessageCursor` emits. */
const b64 = (value: string) =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const message = {
  id: UUID_A,
  conversationId: UUID_B,
  sequence: 3,
  senderId: UUID_A,
  senderFullName: 'DELA CRUZ, JUAN',
  body: 'Good morning',
  createdAt: '2026-10-07T08:00:00.000Z',
};

describe('createMessageRequestSchema', () => {
  it('accepts a body and a request id and nothing else', () => {
    const parsed = createMessageRequestSchema.parse({ body: 'Good morning', requestId: UUID_A });
    expect(parsed.body).toBe('Good morning');
    expect(parsed.requestId).toBe(UUID_A);
  });

  it('rejects an unknown field', () => {
    expect(
      createMessageRequestSchema.safeParse({
        body: 'Good morning',
        requestId: UUID_A,
        senderId: UUID_B,
      }).success,
    ).toBe(false);
  });

  it('exposes no edit or delete field', () => {
    const shape = Object.keys((createMessageRequestSchema as unknown as { shape: object }).shape);
    for (const forbidden of [
      'senderId',
      'senderFullName',
      'createdAt',
      'sequence',
      'editedAt',
      'editBody',
      'deletedAt',
      'deleted',
    ]) {
      expect(shape, `createMessageRequestSchema must not accept ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it('rejects a body that is empty after trimming, and one of 4001 characters', () => {
    for (const bad of ['', '   ', 'x'.repeat(4001)]) {
      expect(
        createMessageRequestSchema.safeParse({ body: bad, requestId: UUID_A }).success,
        bad.slice(0, 12),
      ).toBe(false);
    }
    expect(
      createMessageRequestSchema.safeParse({ body: 'x'.repeat(4000), requestId: UUID_A }).success,
    ).toBe(true);
  });

  it('trims the body, so padding is not stored', () => {
    const parsed = createMessageRequestSchema.parse({ body: '  ok  ', requestId: UUID_A });
    expect(parsed.body).toBe('ok');
  });

  it('rejects an out-of-range requestId', () => {
    for (const bad of ['not-a-uuid', '', '1', 42, null]) {
      expect(
        createMessageRequestSchema.safeParse({ body: 'ok', requestId: bad }).success,
        String(bad),
      ).toBe(false);
    }
  });
});

describe('markConversationReadRequestSchema', () => {
  it('takes a message id and no read timestamp', () => {
    expect(markConversationReadRequestSchema.safeParse({ messageId: UUID_A }).success).toBe(true);
    expect(
      markConversationReadRequestSchema.safeParse({ messageId: UUID_A, readAt: 'whenever' })
        .success,
    ).toBe(false);
    expect(markConversationReadRequestSchema.safeParse({ messageId: 'nope' }).success).toBe(false);
  });
});

describe('audienceInputSchema', () => {
  it('accepts each of the four audience kinds', () => {
    expect(audienceInputSchema.safeParse({ kind: 'all_staff' }).success).toBe(true);
    expect(audienceInputSchema.safeParse({ kind: 'role', roleSlug: 'admin' }).success).toBe(true);
    expect(
      audienceInputSchema.safeParse({ kind: 'department', departmentId: UUID_A }).success,
    ).toBe(true);
    expect(audienceInputSchema.safeParse({ kind: 'staff', staffId: UUID_A }).success).toBe(true);
  });

  it('rejects an audience carrying two discriminators', () => {
    expect(
      audienceInputSchema.safeParse({ kind: 'role', roleSlug: 'admin', staffId: UUID_B }).success,
    ).toBe(false);
  });

  it('rejects an audience carrying none', () => {
    expect(audienceInputSchema.safeParse({ kind: 'role' }).success).toBe(false);
    expect(audienceInputSchema.safeParse({ roleSlug: 'admin' }).success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(audienceInputSchema.safeParse({ kind: 'everyone' }).success).toBe(false);
  });
});

describe('announcementDraftRequestSchema', () => {
  const draft = {
    title: 'Company-wide meeting',
    body: 'Please attend on Friday.',
    audiences: [{ kind: 'all_staff' }],
  };

  it('accepts a draft', () => {
    expect(announcementDraftRequestSchema.safeParse(draft).success).toBe(true);
  });

  it('rejects an out-of-range title or body', () => {
    expect(announcementDraftRequestSchema.safeParse({ ...draft, title: '' }).success).toBe(false);
    expect(
      announcementDraftRequestSchema.safeParse({ ...draft, title: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(announcementDraftRequestSchema.safeParse({ ...draft, body: '' }).success).toBe(false);
    expect(
      announcementDraftRequestSchema.safeParse({ ...draft, body: 'x'.repeat(10001) }).success,
    ).toBe(false);
  });

  it('rejects a client-asserted status or publication time', () => {
    expect(
      announcementDraftRequestSchema.safeParse({ ...draft, status: 'published' }).success,
    ).toBe(false);
    expect(
      announcementDraftRequestSchema.safeParse({ ...draft, publishedAt: '2026-10-07T08:00:00Z' })
        .success,
    ).toBe(false);
  });

  it('rejects an over-limit audience list', () => {
    const audience = { kind: 'staff' as const, staffId: UUID_A };
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        kind: 'staff' as const,
        staffId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      }));
    expect(many(ANNOUNCEMENT_MAX_AUDIENCES).length).toBe(50);
    expect(
      announcementDraftRequestSchema.safeParse({ ...draft, audiences: many(50) }).success,
    ).toBe(true);
    expect(
      announcementDraftRequestSchema.safeParse({ ...draft, audiences: many(51) }).success,
    ).toBe(false);
    expect(announcementDraftRequestSchema.safeParse({ ...draft, audiences: [] }).success).toBe(
      false,
    );
    expect(
      announcementDraftRequestSchema.safeParse({ ...draft, audiences: [audience] }).success,
    ).toBe(true);
  });
});

describe('communicationAnnouncementSchema', () => {
  it('exposes no audience-row id and no recipient list', () => {
    const shape = Object.keys(
      (communicationAnnouncementSchema as unknown as { shape: object }).shape,
    );
    for (const forbidden of [
      'audienceId',
      'audienceIds',
      'audiences',
      'recipients',
      'recipientIds',
      'readCount',
      'authorId',
    ]) {
      expect(shape, `communicationAnnouncementSchema must not expose ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it('carries only the lifecycle status from lifecycle.ts', () => {
    const parsed = communicationAnnouncementSchema.parse({
      id: UUID_A,
      title: 'Company-wide meeting',
      body: 'Please attend on Friday.',
      status: 'published',
      createdAt: '2026-10-07T08:00:00.000Z',
      publishedAt: '2026-10-07T09:00:00.000Z',
      readAt: null,
    });
    expect(parsed.status).toBe('published');
    expect(parsed.readAt).toBeNull();
    expect(
      communicationAnnouncementSchema.safeParse({
        id: UUID_A,
        title: 'x',
        body: 'y',
        status: 'sent',
        createdAt: '2026-10-07T08:00:00.000Z',
        publishedAt: null,
        readAt: null,
      }).success,
    ).toBe(false);
  });
});

describe('announcement lifecycle', () => {
  it('spells draft -> published -> archived and nothing else', () => {
    expect([...announcementStatusSchema.options].sort()).toEqual([
      'archived',
      'draft',
      'published',
    ]);
    expect(ANNOUNCEMENT_TRANSITIONS.draft).toEqual(['published']);
    expect(ANNOUNCEMENT_TRANSITIONS.published).toEqual(['archived']);
    expect(ANNOUNCEMENT_TRANSITIONS.archived).toEqual([]);
  });
});

describe('createConversationRequestSchema', () => {
  const base = {
    kind: 'group' as const,
    title: 'Sales Team',
    participantIds: [UUID_A, UUID_B],
    requestId: UUID_A,
  };

  it('rejects an empty participant list', () => {
    expect(createConversationRequestSchema.safeParse({ ...base, participantIds: [] }).success).toBe(
      false,
    );
  });

  it('rejects a group with 50 or more participants', () => {
    const fifty = Array.from(
      { length: 50 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(
      createConversationRequestSchema.safeParse({ ...base, participantIds: fifty }).success,
    ).toBe(false);
    expect(
      createConversationRequestSchema.safeParse({ ...base, participantIds: fifty.slice(0, 49) })
        .success,
    ).toBe(true);
  });

  it('rejects unknown fields', () => {
    expect(createConversationRequestSchema.safeParse({ ...base, createdBy: UUID_B }).success).toBe(
      false,
    );
  });

  it('rejects a non-uuid participant and a non-uuid request id', () => {
    expect(
      createConversationRequestSchema.safeParse({ ...base, participantIds: ['nope'] }).success,
    ).toBe(false);
    expect(createConversationRequestSchema.safeParse({ ...base, requestId: 'nope' }).success).toBe(
      false,
    );
  });

  it('accepts a direct conversation with exactly one participant', () => {
    expect(
      createConversationRequestSchema.safeParse({
        kind: 'direct',
        participantIds: [UUID_A],
        requestId: UUID_A,
      }).success,
    ).toBe(true);
  });

  it('rejects a direct conversation carrying more than one participant', () => {
    // A direct conversation is the creator plus ONE other person. Anything
    // larger is a group and must be created as one, so it can be named,
    // scoped and managed.
    expect(
      createConversationRequestSchema.safeParse({
        kind: 'direct',
        participantIds: [UUID_A, UUID_B],
        requestId: UUID_A,
      }).success,
    ).toBe(false);
  });

  it('requires a non-empty group title within 1..200 characters', () => {
    for (const bad of [undefined, '', '   ', 'x'.repeat(201)]) {
      expect(
        createConversationRequestSchema.safeParse({
          kind: 'group',
          title: bad,
          participantIds: [UUID_A],
          requestId: UUID_A,
        }).success,
        String(bad),
      ).toBe(false);
    }
    expect(
      createConversationRequestSchema.safeParse({
        kind: 'group',
        title: 'x'.repeat(200),
        participantIds: [UUID_A],
        requestId: UUID_A,
      }).success,
    ).toBe(true);
  });
});

describe('addMemberRequestSchema', () => {
  it('accepts only a staff id', () => {
    expect(addMemberRequestSchema.safeParse({ staffId: UUID_A }).success).toBe(true);
    expect(addMemberRequestSchema.safeParse({ staffId: 'nope' }).success).toBe(false);
    expect(addMemberRequestSchema.safeParse({ staffId: UUID_A, roleSlug: 'admin' }).success).toBe(
      false,
    );
  });
});

describe('notificationSchema', () => {
  const base = {
    id: UUID_A,
    type: 'message',
    title: 'New message',
    summary: 'DELA CRUZ, JUAN sent you a message',
    entityType: 'conversation',
    entityId: UUID_B,
    createdAt: '2026-10-07T08:00:00.000Z',
    readAt: null,
  };

  it('accepts type group_removal', () => {
    expect(notificationSchema.safeParse({ ...base, type: 'group_removal' }).success).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(notificationSchema.safeParse({ ...base, type: 'whatever' }).success).toBe(false);
  });

  it('carries no staff id: the recipient is always the session', () => {
    const shape = Object.keys((notificationSchema as unknown as { shape: object }).shape);
    for (const forbidden of ['staffId', 'recipientId', 'actorId', 'roleSlug']) {
      expect(shape, `notificationSchema must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('message cursor codec', () => {
  const payload = {
    v: 1 as const,
    conversationId: UUID_B,
    createdAt: '2026-10-07T08:00:00.000Z',
    id: UUID_A,
  };

  it('round-trips to an identical payload', () => {
    const decoded = decodeMessageCursor(encodeMessageCursor(payload), UUID_B);
    expect(decoded).toEqual(payload);
  });

  it('emits base64url with no padding and no url-unsafe characters', () => {
    const cursor = encodeMessageCursor(payload);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain('=');
  });

  it('rejects a cursor bound to a different conversation', () => {
    const cursor = encodeMessageCursor(payload);
    expect(() => decodeMessageCursor(cursor, UUID_A)).toThrow();
    expect(() => decodeMessageCursor(cursor, UUID_B)).not.toThrow();
  });

  it('requires the caller to name the conversation it is decoding for', () => {
    // The second parameter is REQUIRED, not optional: an optional binding check
    // is a cross-conversation read waiting to happen, because a later handler
    // that forgets it silently accepts a foreign cursor. `@ts-expect-error`
    // fails the build if the parameter ever becomes optional again.
    // @ts-expect-error - expectedConversationId is deliberately not optional
    expect(() => decodeMessageCursor(encodeMessageCursor(payload))).toThrow();
  });

  it('rejects a version other than 1', () => {
    expect(() => decodeMessageCursor(b64(JSON.stringify({ ...payload, v: 2 })), UUID_B)).toThrow();
    expect(() => decodeMessageCursor(b64(JSON.stringify({ ...payload, v: 0 })), UUID_B)).toThrow();
    expect(() =>
      decodeMessageCursor(b64(JSON.stringify({ ...payload, v: '1' })), UUID_B),
    ).toThrow();
  });

  it('rejects a cursor carrying an extra key', () => {
    // messageCursorSchema is strict: a cursor with a field this codec does not
    // understand is rejected, never silently stripped. A stripped key would
    // mean the payload said something the decoder ignored.
    const forged = b64(JSON.stringify({ ...payload, sequence: 99 }));
    expect(messageCursorSchema.safeParse({ ...payload, sequence: 99 }).success).toBe(false);
    expect(() => decodeMessageCursor(forged, UUID_B)).toThrow();
  });

  it('rejects a cursor that is not decodable JSON', () => {
    // Asserted against the DECODER, not only against the schema: a schema
    // assertion passes even if the decode path stops validating at all.
    expect(() => decodeMessageCursor('not-base64url-json', UUID_B)).toThrow();
    expect(() => decodeMessageCursor('bm90LWpzb24', UUID_B)).toThrow();
    expect(() => decodeMessageCursor('', UUID_B)).toThrow();
    expect(() => decodeMessageCursor(b64('plain text, not json'), UUID_B)).toThrow();
    expect(() => decodeMessageCursor(b64(JSON.stringify({})), UUID_B)).toThrow();
    expect(() => decodeMessageCursor(b64(JSON.stringify([1, 2, 3])), UUID_B)).toThrow();
  });

  it('rejects a cursor missing a required field', () => {
    for (const partial of [
      { v: 1, conversationId: UUID_B, createdAt: payload.createdAt },
      { v: 1, conversationId: UUID_B, id: UUID_A },
      { v: 1, createdAt: payload.createdAt, id: UUID_A },
      { conversationId: UUID_B, createdAt: payload.createdAt, id: UUID_A },
    ]) {
      expect(() => decodeMessageCursor(b64(JSON.stringify(partial)), UUID_B)).toThrow();
    }
  });
});

describe('message page and conversation', () => {
  it('pages messages with a null-terminating cursor', () => {
    const parsed = communicationMessagePageSchema.parse({
      data: [message],
      meta: { nextCursor: null },
    });
    expect(parsed.data).toHaveLength(1);
    expect(parsed.meta.nextCursor).toBeNull();
    expect(
      communicationMessagePageSchema.safeParse({ data: [message] }).success,
      'meta is required, never silently defaulted',
    ).toBe(false);
  });

  it('flags a conversation as historical-only when the caller was removed', () => {
    const conversation = {
      id: UUID_B,
      kind: 'group' as const,
      title: 'Sales Team',
      createdAt: '2026-10-07T08:00:00.000Z',
      archivedAt: null,
      unreadCount: 0,
      lastMessageAt: '2026-10-07T09:00:00.000Z',
      lastMessagePreview: 'Good morning',
      historicalOnly: true,
    };
    expect(communicationConversationSchema.parse(conversation).historicalOnly).toBe(true);
    expect(communicationMessageSchema.parse(message).sequence).toBe(3);
  });
});
