import { beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  createSignedUrl: vi.fn(),
}));
vi.mock('./storage.js', () => ({ storageClient: () => ({ from: () => storage }) }));
import {
  decodeMemberIdentityDocument,
  saveMemberIdentityDocument,
  removeMemberIdentityDocument,
  memberIdentityDocumentLink,
} from './member-identity-document.js';
const input = {
  mimeType: 'application/pdf' as const,
  dataBase64: Buffer.from('%PDF-1.7 synthetic ID').toString('base64'),
};
beforeEach(() => {
  vi.resetAllMocks();
  storage.upload.mockResolvedValue({ error: null });
});
describe('private onboarding IDs', () => {
  it('rejects forged MIME, malformed encoding and oversized contents', () => {
    expect(decodeMemberIdentityDocument(input)).not.toBeNull();
    expect(decodeMemberIdentityDocument({ ...input, mimeType: 'image/png' })).toBeNull();
    expect(decodeMemberIdentityDocument({ ...input, dataBase64: 'invalid@@@' })).toBeNull();
    expect(
      decodeMemberIdentityDocument({
        ...input,
        dataBase64: Buffer.alloc(2097153).toString('base64'),
      }),
    ).toBeNull();
  });
  it('uploads privately without overwrite and uses only a server-derived path', async () => {
    await saveMemberIdentityDocument('staff', 'synthetic-id', input);
    expect(storage.upload).toHaveBeenCalledWith(
      'member-identification/staff/synthetic-id/identity',
      expect.any(Buffer),
      expect.objectContaining({ upsert: false, contentType: 'application/pdf' }),
    );
  });
  it('replays identical uploads but refuses changed bytes after a duplicate', async () => {
    storage.upload.mockResolvedValue({ error: { statusCode: '409' } });
    storage.download.mockResolvedValue({
      data: new Blob([Buffer.from(input.dataBase64, 'base64')]),
      error: null,
    });
    await expect(
      saveMemberIdentityDocument('ost_application', 'id', input),
    ).resolves.toBeUndefined();
    storage.download.mockResolvedValue({ data: new Blob(['different']), error: null });
    await expect(saveMemberIdentityDocument('ost_application', 'id', input)).rejects.toThrow(
      'cannot be overwritten',
    );
  });
  it('cleans only the failed IST account document and issues short-lived links', async () => {
    storage.remove.mockResolvedValue({ error: null });
    await removeMemberIdentityDocument('new-account');
    expect(storage.remove).toHaveBeenCalledWith([
      'member-identification/staff/new-account/identity',
    ]);
    storage.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://private.test/signed' },
      error: null,
    });
    expect((await memberIdentityDocumentLink('staff', 'id')).url).toBe(
      'https://private.test/signed',
    );
    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      'member-identification/staff/id/identity',
      60,
      { download: 'identity-document' },
    );
  });
});
