import { DEFAULT_FEATURE_FLAGS, setFeatureFlags } from '@afhomes/shared';

import { serviceClient } from './rest.js';

/**
 * Keeps the shared module switches (`@afhomes/shared` FEATURE_FLAGS) in step with
 * the stored values (migration 20270105000025). Read through the service role at
 * most once per TTL per warm instance; a missing table, a missing service role or
 * any read error keeps the last good values (initially the code defaults, all ON),
 * so a storage problem can never take the whole API down. Another warm instance
 * may serve a changed switch for up to the TTL (15s) after a save.
 */
const TTL_MS = 15_000;
/** After a failed read, retry soon instead of waiting a full TTL. */
const RETRY_MS = 2_000;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

type Rpc = {
  rpc: (fn: string) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export async function refreshFeatureFlags(now: number = Date.now()): Promise<void> {
  if (now - loadedAt < TTL_MS) return;
  if (inflight) return inflight;
  const svc = serviceClient() as unknown as Rpc | null;
  if (!svc) return;
  inflight = (async () => {
    try {
      const { data, error } = await svc.rpc('get_feature_flags');
      if (!error && data && typeof data === 'object' && !Array.isArray(data)) {
        setFeatureFlags({ ...DEFAULT_FEATURE_FLAGS, ...(data as Record<string, unknown>) });
        loadedAt = Date.now();
        return;
      }
      if (error) console.error('[api] module switches unreadable; keeping last values');
    } catch {
      console.error('[api] module switches unreadable; keeping last values');
    } finally {
      // A failed read retries after RETRY_MS rather than serving stale values for a TTL.
      if (loadedAt < Date.now() - TTL_MS) loadedAt = Date.now() - TTL_MS + RETRY_MS;
      inflight = null;
    }
  })();
  return inflight;
}

/** Forces the next request to re-read the store (after a save on this instance). */
export function invalidateFeatureFlags(): void {
  loadedAt = 0;
}
