import type { ContentKind, ForwardableContent } from '@jad/contracts';

import { MOCK_CONTENT } from './data';

/**
 * In-memory mock store for Marketing Tools (FR-ADM-003). Mutations write
 * through here so the mock list stays consistent across GET + detail reads
 * within a dev/test session. Mirrors `POST /admin/content` (share targets
 * server-provided). Production reads/writes the real endpoint - this is a
 * test double only.
 */

let contentSeq = MOCK_CONTENT.length + 1;

export const contentStore: { items: ForwardableContent[] } = {
  items: MOCK_CONTENT.map((item) => ({
    ...item,
    share: item.share ? { ...item.share } : undefined,
  })),
};

/** Remove an item by id; returns true when an item was removed. */
export function deleteStoreContent(id: string): boolean {
  const index = contentStore.items.findIndex((item) => item.id === id);
  if (index === -1) return false;
  contentStore.items.splice(index, 1);
  return true;
}

/** Restore seed state (specs call this to isolate mutation tests). */
export function resetContentStore(): void {
  contentStore.items = MOCK_CONTENT.map((item) => ({
    ...item,
    share: item.share ? { ...item.share } : undefined,
  }));
  contentSeq = MOCK_CONTENT.length + 1;
}

export function createStoreContent(input: {
  title: string;
  description?: string;
  kind: ContentKind;
  downloadUrl: string;
}): ForwardableContent {
  const title = input.title.trim();
  if (!title) throw new Error('A title is required.');
  if (!input.downloadUrl) throw new Error('An uploaded file is required.');
  const downloadUrl = input.downloadUrl;
  const item: ForwardableContent = {
    id: `cnt-mock-${Date.now().toString(36)}-${contentSeq++}`,
    title,
    ...(input.description?.trim() && { description: input.description.trim() }),
    kind: input.kind,
    downloadUrl,
    share: {
      messengerUrl: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(downloadUrl)}`,
      viberUrl: `https://www.viber.com/forward?text=${encodeURIComponent(title)}`,
      copyUrl: downloadUrl,
    },
    createdAt: new Date().toISOString(),
  };
  contentStore.items.unshift(item);
  return item;
}
