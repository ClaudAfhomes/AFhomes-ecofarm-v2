import { createClient } from '@supabase/supabase-js';

import { getSupabaseEnv } from './env.js';

/**
 * Server-only Supabase Storage access (service role, bypasses RLS).
 *
 * Identity documents live in private buckets, so every byte moves through
 * here: signed upload URLs for intake, downloads for OCR validation, and
 * short-lived signed URLs for reviewer preview. No storage URL with a secret
 * or a long life ever leaves this module except inside a handler response
 * that has already authorized the caller.
 *
 * Tests replace this module wholesale (`vi.mock` on `_lib/storage.js`), the
 * same seam production uses - the handler's real code path is what runs.
 */

function makeStorage(url: string, serviceKey: string) {
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false } }).storage;
}

let cached: ReturnType<typeof makeStorage> | null = null;
let cachedKey = '';

/** Service-role storage client, or null when unconfigured. Callers respond 500. */
export function storageClient() {
  const { url, serviceKey } = getSupabaseEnv();
  if (!url || !serviceKey) return null;
  if (!cached || cachedKey !== serviceKey) {
    cached = makeStorage(url, serviceKey);
    cachedKey = serviceKey;
  }
  return cached;
}

export type Storage = NonNullable<ReturnType<typeof storageClient>>;

/**
 * Signed intake grant for one server-generated path. The browser must start
 * the PUT within the grant window; the object itself stays private.
 */
export async function createUploadGrant(
  storage: Storage,
  bucket: string,
  path: string,
  windowSeconds = 600,
): Promise<{ uploadUrl: string; expiresAt: string }> {
  const { data, error } = await storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) {
    throw new Error(`Signed upload URL failed: ${error?.message ?? 'no URL returned'}`);
  }
  return {
    uploadUrl: data.signedUrl,
    expiresAt: new Date(Date.now() + windowSeconds * 1000).toISOString(),
  };
}

/** Short-lived, single-document download grant for an authorized reviewer. */
export async function createDownloadGrant(
  storage: Storage,
  bucket: string,
  path: string,
  ttlSeconds = 60,
): Promise<{ url: string; expiresAt: string }> {
  const { data, error } = await storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`Signed download URL failed: ${error?.message ?? 'no URL returned'}`);
  }
  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}

/** Download an object for server-side validation and OCR. Never throws. */
export async function downloadObject(
  storage: Storage,
  bucket: string,
  path: string,
): Promise<{ bytes: Uint8Array } | { error: string }> {
  try {
    const { data, error } = await storage.from(bucket).download(path);
    if (error || !data) return { error: error?.message ?? 'download returned no data' };
    const buffer = await data.arrayBuffer();
    return { bytes: new Uint8Array(buffer) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'download failed' };
  }
}
