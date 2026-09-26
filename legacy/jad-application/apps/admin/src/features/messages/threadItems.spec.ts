import { describe, expect, it } from 'vitest';

import type { Message } from '@jad/contracts';

import { COMPOSER_MAX_HEIGHT_PX, buildThreadItems, capComposerHeight } from './threadItems';

const msg = (id: string, senderType: 'MEMBER' | 'STAFF', createdAt: string): Message => ({
  id,
  senderType,
  senderName: senderType === 'STAFF' ? 'Ada Admin' : 'Juan Dela Cruz',
  body: `body ${id}`,
  createdAt,
});

describe('buildThreadItems', () => {
  it('returns a day separator before the first message of each day', () => {
    const items = buildThreadItems(
      [
        msg('1', 'MEMBER', '2026-09-12T09:00:00.000Z'),
        msg('2', 'STAFF', '2026-09-13T10:00:00.000Z'),
      ],
      new Date('2026-09-14T12:00:00.000Z'),
    );
    expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'day', 'message']);
    expect(items[0]).toMatchObject({ kind: 'day', label: 'Sep 12, 2026' });
    expect(items[2]).toMatchObject({ kind: 'day', label: 'Yesterday' });
  });

  it('uses Today/Yesterday for adjacent days', () => {
    const now = new Date('2026-09-14T12:00:00.000Z');
    const items = buildThreadItems(
      [
        msg('1', 'MEMBER', '2026-09-14T09:00:00.000Z'),
        msg('2', 'STAFF', '2026-09-13T10:00:00.000Z'),
      ],
      now,
    );
    expect(items[0]).toMatchObject({ kind: 'day', label: 'Today' });
    expect(items[2]).toMatchObject({ kind: 'day', label: 'Yesterday' });
  });

  it('groups consecutive same-sender messages within 5 minutes', () => {
    const items = buildThreadItems(
      [
        msg('1', 'MEMBER', '2026-09-14T09:00:00.000Z'),
        msg('2', 'MEMBER', '2026-09-14T09:02:00.000Z'),
        msg('3', 'STAFF', '2026-09-14T09:03:00.000Z'),
      ],
      new Date('2026-09-14T12:00:00.000Z'),
    );
    const messages = items.filter((i) => i.kind === 'message') as Extract<
      (typeof items)[number],
      { kind: 'message' }
    >[];
    expect(messages.map((m) => m.message.id)).toEqual(['1', '2', '3']);
    expect(messages[0]?.firstOfGroup).toBe(true);
    expect(messages[0]?.lastOfGroup).toBe(false);
    expect(messages[1]?.firstOfGroup).toBe(false);
    expect(messages[1]?.lastOfGroup).toBe(true);
    expect(messages[2]?.firstOfGroup).toBe(true);
    expect(messages[2]?.lastOfGroup).toBe(true);
  });

  it('splits groups when the sender changes or the gap exceeds 5 minutes', () => {
    const items = buildThreadItems(
      [
        msg('1', 'MEMBER', '2026-09-14T09:00:00.000Z'),
        msg('2', 'MEMBER', '2026-09-14T09:10:00.000Z'),
        msg('3', 'STAFF', '2026-09-14T09:11:00.000Z'),
      ],
      new Date('2026-09-14T12:00:00.000Z'),
    );
    const messages = items.filter((i) => i.kind === 'message') as Extract<
      (typeof items)[number],
      { kind: 'message' }
    >[];
    expect(messages.every((m) => m.firstOfGroup)).toBe(true);
    expect(messages.every((m) => m.lastOfGroup)).toBe(true);
  });
});

describe('capComposerHeight', () => {
  it('passes through short content and caps tall content at the max', () => {
    expect(capComposerHeight(90)).toBe(90);
    expect(capComposerHeight(500)).toBe(COMPOSER_MAX_HEIGHT_PX);
    expect(capComposerHeight(COMPOSER_MAX_HEIGHT_PX)).toBe(COMPOSER_MAX_HEIGHT_PX);
  });

  it('returns null for non-positive or non-finite heights (hidden/measuring)', () => {
    expect(capComposerHeight(0)).toBeNull();
    expect(capComposerHeight(-4)).toBeNull();
    expect(capComposerHeight(Number.NaN)).toBeNull();
  });
});
