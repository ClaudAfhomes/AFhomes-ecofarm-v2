import { decodeProfilePhoto } from './profile-photo-validation.js';
export { decodeProfilePhoto, isProfileJpeg } from './profile-photo-validation.js';
import { storageClient } from './storage.js';

export const PROFILE_PHOTO_BUCKET = 'afhomes-profile-photos';
export const profilePhotoPath = (userId: string) => `${userId}/profile.jpg`;

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
