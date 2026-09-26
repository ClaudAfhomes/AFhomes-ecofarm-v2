import type { Message } from '@jad/contracts';

import { formatDayLabel } from '../../lib/format';

const GROUP_GAP_MS = 5 * 60 * 1000;

/** Composer auto-grow ceiling (~5 rows) - the box never scrolls internally below it. */
export const COMPOSER_MAX_HEIGHT_PX = 132;

/**
 * Auto-grow height for the composer textarea: follow content up to the cap;
 * null when there is nothing measurable (hidden element), so callers leave
 * the natural `rows` height alone instead of collapsing the box.
 */
export function capComposerHeight(
  scrollHeightPx: number,
  maxPx: number = COMPOSER_MAX_HEIGHT_PX,
): number | null {
  if (!Number.isFinite(scrollHeightPx) || scrollHeightPx <= 0) return null;
  return Math.min(scrollHeightPx, maxPx);
}

export type ThreadDayItem = { kind: 'day'; key: string; label: string };
export type ThreadMessageItem = {
  kind: 'message';
  key: string;
  message: Message;
  firstOfGroup: boolean;
  lastOfGroup: boolean;
};
export type ThreadItem = ThreadDayItem | ThreadMessageItem;

function sameGroup(a: Message, b: Message): boolean {
  return (
    a.senderType === b.senderType &&
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() <= GROUP_GAP_MS
  );
}

/**
 * Flatten an oldest→newest thread into render items: a day separator when the
 * calendar day changes, and message entries with group boundaries (consecutive
 * same-sender messages within 5 minutes share a bubble cluster - the sender
 * and timestamp render once per group).
 */
export function buildThreadItems(messages: Message[], now: Date = new Date()): ThreadItem[] {
  const items: ThreadItem[] = [];
  let lastDay = '';
  let previous: Message | undefined;
  let lastMessageIndex = -1;

  const closeGroup = () => {
    if (lastMessageIndex >= 0 && items[lastMessageIndex]!.kind === 'message') {
      (items[lastMessageIndex] as ThreadMessageItem).lastOfGroup = true;
    }
  };

  for (const message of messages) {
    const day = formatDayLabel(message.createdAt, now);
    if (day !== lastDay) {
      closeGroup();
      lastDay = day;
      items.push({ kind: 'day', key: `day-${day}`, label: day });
    }
    const continues = previous ? sameGroup(previous, message) : false;
    if (!continues) closeGroup();
    items.push({
      kind: 'message',
      key: message.id,
      message,
      firstOfGroup: !continues,
      lastOfGroup: false,
    });
    lastMessageIndex = items.length - 1;
    previous = message;
  }
  closeGroup();
  return items;
}
