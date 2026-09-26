import type { ContentKind } from '@jad/contracts';

import { env } from '../../../lib/env';
import { getSupabaseClient } from '../../../lib/supabase';

/**
 * Shared upload rules + direct-to-Storage uploader for marketing tools
 * (FR-ADM-003). Single source for the create and edit dialogs: per-kind
 * accept filters and size caps must stay within the `marketing-tools`
 * bucket's `file_size_limit` / `allowed_mime_types` (migration
 * 20260926000001_marketing_tools_bucket_limits.sql).
 */
export const KIND_ACCEPT: Record<ContentKind, string> = {
  DOCUMENT: '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx',
  IMAGE: 'image/jpeg,image/png,image/webp',
  VIDEO: 'video/mp4,video/webm,video/quicktime',
  PROMO: '*/*',
};

export const KIND_MAX_SIZE: Record<ContentKind, number> = {
  DOCUMENT: 20 * 1024 * 1024,
  IMAGE: 20 * 1024 * 1024,
  VIDEO: 100 * 1024 * 1024,
  PROMO: 50 * 1024 * 1024,
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Build a specific message for a failed direct-to-Storage PUT. Supabase
 * answers with a JSON `{message}` (e.g. bucket MIME/size rejections) - pass
 * it through so a bucket misconfiguration is diagnosable instead of a dead
 * end; fall back to raw text, then the generic message.
 */
export async function putErrorMessage(fileName: string, putRes: Response): Promise<string> {
  const fallback = `"${fileName}" failed to upload. Remove and try again.`;
  try {
    const text = await putRes.text();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
      const detail =
        (typeof parsed.message === 'string' && parsed.message) ||
        (typeof parsed.error === 'string' && parsed.error) ||
        '';
      return detail
        ? `"${fileName}": storage rejected the upload (${detail.slice(0, 200)})`
        : fallback;
    } catch {
      return text ? `"${fileName}": storage rejected the upload (${text.slice(0, 200)})` : fallback;
    }
  } catch {
    return fallback;
  }
}

/** Mirror the input `accept` filter so mismatched drops get an explicit error. */
export function matchesAccept(file: File, accept: string): boolean {
  const tokens = accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const mime = file.type.toLowerCase();
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  return tokens.some((token) => {
    if (token.startsWith('.')) return `.${ext}` === token;
    if (token.endsWith('/*')) return mime.startsWith(token.slice(0, -1));
    return mime === token;
  });
}

/**
 * Upload one file direct-to-Storage via a signed URL, returning the public
 * download URL. Mirrors the create dialog's upload step.
 */
export async function uploadContentFile(
  selectedFile: File,
  kind: ContentKind,
): Promise<{ downloadUrl: string } | { error: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { error: 'Upload unavailable - please reload and try again.' };

  let token: string | undefined;
  try {
    const sess = await supabase.auth.getSession();
    token = sess?.data?.session?.access_token ?? undefined;
  } catch {
    /* proceed without token - sign endpoint handles missing auth */
  }

  let signRes: Response;
  try {
    signRes = await fetch(`${env.VITE_API_BASE_URL}/cms/upload/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        name: selectedFile.name,
        type: selectedFile.type,
        size: selectedFile.size,
        kind,
      }),
    });
  } catch {
    return { error: `"${selectedFile.name}" could not reach the upload service.` };
  }

  if (!signRes.ok) {
    let message = `"${selectedFile.name}" was rejected for upload.`;
    try {
      const errJson = (await signRes.json()) as { error?: { message?: string } };
      if (errJson?.error?.message) message = `"${selectedFile.name}": ${errJson.error.message}`;
    } catch {
      // keep the generic message when the body is not JSON
    }
    return { error: message };
  }

  const signJson = (await signRes.json()) as { signedUrl: string; publicUrl: string };
  if (!signJson.signedUrl || !signJson.publicUrl) {
    return { error: `"${selectedFile.name}" failed to upload. Remove and try again.` };
  }

  try {
    const putRes = await fetch(signJson.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': selectedFile.type },
      body: selectedFile,
    });
    if (!putRes.ok) return { error: await putErrorMessage(selectedFile.name, putRes) };
  } catch {
    return { error: `"${selectedFile.name}" failed to upload. Remove and try again.` };
  }

  return { downloadUrl: signJson.publicUrl };
}
