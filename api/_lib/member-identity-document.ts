import { createHash } from 'node:crypto';
import { memberIdentityDocumentSchema, type MemberIdentityDocument } from '@afhomes/contracts';
import { mimeMatchesSignature, OST_IDS_BUCKET } from './documents.js';
import { storageClient } from './storage.js';

export const memberIdentityPath = (kind: 'staff' | 'ost_application', id: string) =>
  `member-identification/${kind}/${id}/identity`;
export function decodeMemberIdentityDocument(input: unknown): Buffer | null {
  const result = memberIdentityDocumentSchema.safeParse(input);
  if (!result.success) return null;
  const bytes = Buffer.from(result.data.dataBase64, 'base64');
  if (
    bytes.length > 2 * 1024 * 1024 ||
    bytes.toString('base64') !== result.data.dataBase64 ||
    !mimeMatchesSignature(result.data.mimeType, bytes)
  )
    return null;
  return bytes;
}
export async function saveMemberIdentityDocument(
  kind: 'staff' | 'ost_application',
  id: string,
  input: MemberIdentityDocument,
) {
  const bytes = decodeMemberIdentityDocument(input);
  if (!bytes) throw new Error('Choose a valid JPEG, PNG or PDF ID document up to 2 MB.');
  const bucket = storageClient()?.from(OST_IDS_BUCKET);
  if (!bucket) throw new Error('Private ID storage is unavailable.');
  const path = memberIdentityPath(kind, id);
  const result = await bucket.upload(path, bytes, {
    contentType: input.mimeType,
    cacheControl: '0',
    upsert: false,
  });
  if (!result.error) return;
  // A lost response may be retried, but a different file must never overwrite history.
  if (String(result.error.statusCode) === '409' || String(result.error.statusCode) === '400') {
    const previous = await bucket.download(path);
    if (previous.data && !previous.error) {
      const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
      if (digest(new Uint8Array(await previous.data.arrayBuffer())) === digest(bytes)) return;
    }
  }
  throw new Error('Could not save the ID document. An existing ID cannot be overwritten.');
}
export async function removeMemberIdentityDocument(id: string) {
  const result = await storageClient()
    ?.from(OST_IDS_BUCKET)
    .remove([memberIdentityPath('staff', id)]);
  if (!result || result.error) throw new Error('ID document cleanup needs administrator review.');
}
export async function memberIdentityDocumentLink(kind: 'staff' | 'ost_application', id: string) {
  const bucket = storageClient()?.from(OST_IDS_BUCKET);
  if (!bucket) throw new Error('Private ID storage is unavailable.');
  const { data, error } = await bucket.createSignedUrl(memberIdentityPath(kind, id), 60, {
    download: 'identity-document',
  });
  if (error) {
    if (
      ['404', '400'].includes(String(error.statusCode)) &&
      /not found|does not exist/i.test(error.message)
    )
      return { url: null, expiresAt: null };
    throw new Error('Could not open the private ID document.');
  }
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + 60000).toISOString() };
}
