import type { Policy } from '@jad/contracts';

/**
 * In-memory mock store for admin Policies (FR-ADM-004). Mirrors the
 * `Policy` seed rows (pol-001..003, members pull the same source via
 * `GET /policies`). Mutations write through here so the mock list stays
 * consistent across GET + create/update/delete within a dev/test session.
 * Production reads/writes the real endpoint - this is a test double only.
 */
export const MOCK_POLICIES: Policy[] = [
  {
    id: 'pol-001',
    slug: 'terms',
    title: 'Terms and Conditions',
    type: 'terms',
    content:
      'By registering for JA&D membership you agree to abide by the JA&D terms and conditions.',
    updatedAt: '2026-08-18T10:00:00.000Z',
  },
  {
    id: 'pol-002',
    slug: 'guidelines',
    title: 'Program Guidelines',
    type: 'guidelines',
    content: 'These guidelines describe how qualifying sales and referrals work.',
    updatedAt: '2026-08-18T10:00:00.000Z',
  },
  {
    id: 'pol-003',
    slug: 'privacy',
    title: 'Privacy Policy',
    type: 'privacy',
    content:
      'JA&D collects only the personal information needed to operate the membership platform.',
    updatedAt: '2026-08-18T10:00:00.000Z',
  },
];

let policySeq = MOCK_POLICIES.length + 1;

export const policyStore: { items: Policy[] } = {
  items: MOCK_POLICIES.map((item) => ({ ...item })),
};

/** Restore seed state (specs call this to isolate mutation tests). */
export function resetPolicyStore(): void {
  policyStore.items = MOCK_POLICIES.map((item) => ({ ...item }));
  policySeq = MOCK_POLICIES.length + 1;
}

export function createStorePolicy(input: {
  title: string;
  slug: string;
  type: string;
  content?: string;
  documentUrl: string;
}): Policy {
  const title = input.title.trim();
  if (!title) throw new Error('A title is required.');
  const slug = input.slug.trim();
  if (!slug) throw new Error('A URL slug is required.');
  if (policyStore.items.some((p) => p.slug === slug)) {
    throw new Error('That URL slug is already in use.');
  }
  const type = input.type.trim();
  if (!type) throw new Error('A type is required.');
  if (!input.documentUrl) throw new Error('A PDF upload is required.');
  const item: Policy = {
    id: `pol-mock-${Date.now().toString(36)}-${policySeq++}`,
    slug,
    title,
    type,
    ...(input.content?.trim() && { content: input.content.trim() }),
    documentUrl: input.documentUrl,
    updatedAt: new Date().toISOString(),
  };
  policyStore.items.unshift(item);
  return item;
}

export function updateStorePolicy(
  id: string,
  patch: { title?: string; slug?: string; type?: string; content?: string; documentUrl?: string },
): Policy | undefined {
  const item = policyStore.items.find((p) => p.id === id);
  if (!item) return undefined;
  if (typeof patch.slug === 'string' && patch.slug.trim()) {
    const slug = patch.slug.trim();
    if (policyStore.items.some((p) => p.id !== id && p.slug === slug)) {
      throw new Error('That URL slug is already in use.');
    }
    item.slug = slug;
  }
  if (typeof patch.title === 'string' && patch.title.trim()) item.title = patch.title.trim();
  if (typeof patch.type === 'string' && patch.type.trim()) item.type = patch.type.trim();
  if (typeof patch.content === 'string') item.content = patch.content.trim() || undefined;
  if (typeof patch.documentUrl === 'string' && patch.documentUrl)
    item.documentUrl = patch.documentUrl;
  item.updatedAt = new Date().toISOString();
  return item;
}

/** Remove a policy by id; returns true when a policy was removed. */
export function deleteStorePolicy(id: string): boolean {
  const index = policyStore.items.findIndex((item) => item.id === id);
  if (index === -1) return false;
  policyStore.items.splice(index, 1);
  return true;
}
