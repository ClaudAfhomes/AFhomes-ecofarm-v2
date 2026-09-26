import type { Message } from '@jad/contracts';

/**
 * Canonical in-memory mock store for the admin Messages inbox + threads
 * (FEAT-072, ADR-013). Frontend-only, deterministic IDs, mirrors the real
 * Conversation/Message shape (watermark per side). Later replaced by
 * Supabase/backend - UI calls services/hooks, not this directly.
 */

export interface MockStaffConversation {
  memberId: string;
  memberName: string;
  memberEmail: string;
  staffLastReadAt?: string;
}

export const messagesMockStore: {
  conversations: MockStaffConversation[];
  messages: (Message & { memberId: string })[];
} = {
  conversations: [
    {
      memberId: 'mem-001',
      memberName: 'Juan Dela Cruz',
      memberEmail: 'juan.delacruz@example.com',
    },
    {
      memberId: 'mem-005',
      memberName: 'Ramon Reyes',
      memberEmail: 'ramon.reyes.member@example.com',
    },
  ],
  messages: [
    {
      id: 'msg-001',
      memberId: 'mem-001',
      senderType: 'MEMBER',
      senderName: 'Juan Dela Cruz',
      body: 'Hello, I have a question about my commission.',
      createdAt: '2026-09-12T09:00:00.000Z',
    },
    {
      id: 'msg-002',
      memberId: 'mem-001',
      senderType: 'STAFF',
      senderName: 'Ada Admin',
      body: 'Hi Juan! Happy to help - what would you like to know?',
      createdAt: '2026-09-12T09:30:00.000Z',
    },
    {
      id: 'msg-003',
      memberId: 'mem-005',
      senderType: 'MEMBER',
      senderName: 'Ramon Reyes',
      body: 'When will my payout be processed?',
      createdAt: '2026-09-13T14:00:00.000Z',
    },
  ],
};

/** Restore seed state (specs call this to isolate mutation tests). */
export function resetMessagesMockStore(): void {
  messagesMockStore.conversations = [
    {
      memberId: 'mem-001',
      memberName: 'Juan Dela Cruz',
      memberEmail: 'juan.delacruz@example.com',
    },
    {
      memberId: 'mem-005',
      memberName: 'Ramon Reyes',
      memberEmail: 'ramon.reyes.member@example.com',
    },
  ];
  messagesMockStore.messages = [
    {
      id: 'msg-001',
      memberId: 'mem-001',
      senderType: 'MEMBER',
      senderName: 'Juan Dela Cruz',
      body: 'Hello, I have a question about my commission.',
      createdAt: '2026-09-12T09:00:00.000Z',
    },
    {
      id: 'msg-002',
      memberId: 'mem-001',
      senderType: 'STAFF',
      senderName: 'Ada Admin',
      body: 'Hi Juan! Happy to help - what would you like to know?',
      createdAt: '2026-09-12T09:30:00.000Z',
    },
    {
      id: 'msg-003',
      memberId: 'mem-005',
      senderType: 'MEMBER',
      senderName: 'Ramon Reyes',
      body: 'When will my payout be processed?',
      createdAt: '2026-09-13T14:00:00.000Z',
    },
  ];
}

export function staffUnreadFor(memberId: string): number {
  const conversation = messagesMockStore.conversations.find((c) => c.memberId === memberId);
  if (!conversation) return 0;
  const watermark = conversation.staffLastReadAt;
  return messagesMockStore.messages.filter(
    (m) =>
      m.memberId === memberId &&
      m.senderType === 'MEMBER' &&
      (watermark === undefined || m.createdAt > watermark),
  ).length;
}
