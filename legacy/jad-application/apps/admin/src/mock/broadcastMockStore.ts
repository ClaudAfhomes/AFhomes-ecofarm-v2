import type { Notification } from '@jad/contracts';

/**
 * In-memory mock store for Broadcasts (FEAT-063, SCR-ADM-016). Mutations
 * write through here so the mock list stays consistent across GET + create
 * within a dev/test session. Mirrors `GET /admin/broadcasts` +
 * `POST /broadcasts` (broadcast = Notification row, member audience).
 * Production reads/writes the real endpoints - this is a test double only.
 */

const SEED: Notification[] = [
  {
    id: 'ntf-broadcast-001',
    title: 'New properties in the catalog',
    body: 'The Admin team has added new fixed-value units to the catalog - see the Properties page.',
    createdAt: '2026-09-12T10:00:00.000Z',
  },
  {
    id: 'ntf-broadcast-002',
    title: 'Community announcement',
    body: 'New marketing material and community update - find it in Marketing Tools.',
    createdAt: '2026-09-10T10:00:00.000Z',
  },
];

let broadcastSeq = 3;

export const broadcastStore: { items: Notification[] } = {
  items: SEED.map((item) => ({ ...item })),
};

/** Restore seed state (specs call this to isolate mutation tests). */
export function resetBroadcastStore(): void {
  broadcastStore.items = SEED.map((item) => ({ ...item }));
  broadcastSeq = 3;
}

export function createStoreBroadcast(input: { title: string; body?: string }): Notification {
  const title = input.title.trim();
  if (!title) throw new Error('Enter an announcement title.');
  const body = input.body?.trim();
  const item: Notification = {
    id: `ntf-broadcast-${String(broadcastSeq++).padStart(3, '0')}`,
    title,
    ...(body && { body }),
    createdAt: new Date().toISOString(),
  };
  broadcastStore.items.unshift(item);
  return item;
}
