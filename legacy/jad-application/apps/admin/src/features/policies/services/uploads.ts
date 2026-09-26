import { env } from '../../../lib/env';
import { getSupabaseClient } from '../../../lib/supabase';

/**
 * PDF upload for admin policies (FR-ADM-004). PDFs live in the public
 * `marketing-tools` bucket - the client never names the bucket; it PUTs a
 * server-signed URL and persists the returned `publicUrl` as the policy's
 * `documentUrl`. Limits mirror the server's DOCUMENT rules
 * (`api/v1/cms/upload/sign.ts` KIND_UPLOAD_RULES) and the bucket's
 * `file_size_limit` / `allowed_mime_types` (migration
 * 20260926000001_marketing_tools_bucket_limits.sql): PDF only, 20 MB.
 */
export const POLICY_PDF_ACCEPT = '.pdf';
export const POLICY_PDF_MAX_SIZE = 20 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Reject non-PDF selections with an explicit message. */
export function isPolicyPdf(file: File): boolean {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  return file.type === 'application/pdf' || ext === 'pdf';
}

/**
 * Upload one PDF direct-to-Storage via a signed URL, returning the public
 * document URL. Mirrors `features/content/services/uploads.ts`.
 */
export async function uploadPolicyPdf(
  selectedFile: File,
): Promise<{ documentUrl: string } | { error: string }> {
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
        kind: 'DOCUMENT',
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
    if (!putRes.ok) {
      let detail = '';
      try {
        const text = await putRes.text();
        if (text) {
          try {
            const parsed = JSON.parse(text) as { message?: unknown };
            detail = typeof parsed.message === 'string' ? parsed.message : text;
          } catch {
            detail = text;
          }
        }
      } catch {
        // fall through to the generic message
      }
      return {
        error: detail
          ? `"${selectedFile.name}": storage rejected the upload (${detail.slice(0, 200)})`
          : `"${selectedFile.name}" failed to upload. Remove and try again.`,
      };
    }
  } catch {
    return { error: `"${selectedFile.name}" failed to upload. Remove and try again.` };
  }

  return { documentUrl: signJson.publicUrl };
}
