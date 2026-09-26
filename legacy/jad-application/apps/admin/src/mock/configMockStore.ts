import type { SystemConfigEntry } from '@jad/contracts';

import { MOCK_CONFIG } from './data';

/**
 * In-memory mock store for System Configuration (SCR-ADM-019). Mutations
 * write through here so the mock list stays consistent across GET reads
 * within a dev/test session. Mirrors `PATCH /admin/config/:key`
 * (super_admin-only in production). Test double only.
 */
export const configStore: { entries: SystemConfigEntry[] } = {
  entries: MOCK_CONFIG.map((entry) => ({ ...entry })),
};

/** Update an entry value by key; returns undefined when the key is unknown. */
export function updateStoreConfig(key: string, value: string): SystemConfigEntry | undefined {
  const entry = configStore.entries.find((e) => e.key === key);
  if (!entry) return undefined;
  entry.value = value;
  return entry;
}

/** Restore seed state (specs call this to isolate mutation tests). */
export function resetConfigStore(): void {
  configStore.entries = MOCK_CONFIG.map((entry) => ({ ...entry }));
}
