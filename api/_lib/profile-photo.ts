import { PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_MAX_EDGE } from '@afhomes/contracts';
import { storageClient } from './storage.js';

export const PROFILE_PHOTO_BUCKET = 'afhomes-profile-photos';
export const profilePhotoPath = (userId: string) => `${userId}/profile.jpg`;

export function decodeProfilePhoto(dataBase64: string): Buffer | null {
  const bytes = Buffer.from(dataBase64, 'base64');
  return bytes.length <= PROFILE_PHOTO_MAX_BYTES &&
    bytes.toString('base64') === dataBase64 &&
    isProfileJpeg(bytes)
    ? bytes
    : null;
}

export async function saveProfilePhoto(userId: string, dataBase64: string): Promise<void> {
  const bytes = decodeProfilePhoto(dataBase64);
  if (!bytes) throw new Error('Choose a valid compressed profile photo.');
  const bucket = storageClient()?.from(PROFILE_PHOTO_BUCKET);
  if (!bucket) throw new Error('Profile photo storage is unavailable.');
  const { error } = await bucket.upload(profilePhotoPath(userId), bytes, {
    contentType: 'image/jpeg',
    cacheControl: '0',
    upsert: true,
  });
  if (error) throw new Error('Could not save the profile photo.');
}

export async function removeProfilePhoto(userId: string): Promise<void> {
  const bucket = storageClient()?.from(PROFILE_PHOTO_BUCKET);
  if (!bucket) throw new Error('Profile photo storage is unavailable.');
  const { error } = await bucket.remove([profilePhotoPath(userId)]);
  if (error) throw new Error('Profile photo cleanup needs administrator review.');
}

/** Validate JPEG framing/dimensions before Storage; browser re-encoding removes source metadata. */
export function isProfileJpeg(bytes: Uint8Array): boolean {
  if (
    bytes.length < 20 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  )
    return false;
  let offset = 2,
    frame = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) return false;
    const length = bytes[offset]! * 256 + bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length - 2) return false;
    if (marker === 0xc0 || marker === 0xc2) {
      if (length < 11) return false;
      const height = bytes[offset + 3]! * 256 + bytes[offset + 4]!;
      const width = bytes[offset + 5]! * 256 + bytes[offset + 6]!;
      const channels = bytes[offset + 7];
      if (
        bytes[offset + 2] !== 8 ||
        ![1, 3].includes(channels ?? 0) ||
        length !== 8 + 3 * (channels ?? 0) ||
        !height ||
        !width ||
        height > PROFILE_PHOTO_MAX_EDGE ||
        width > PROFILE_PHOTO_MAX_EDGE
      )
        return false;
      frame = true;
    }
    if (marker === 0xda) return frame && length >= 6;
    offset += length;
  }
  return false;
}
