import { z } from 'zod';

export const PROFILE_PHOTO_MAX_BYTES = 500_000;
export const PROFILE_PHOTO_MAX_EDGE = 512;
export const PROFILE_PHOTO_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const profilePhotoInputSchema = z
  .object({
    expectedUserId: z.string().uuid(),
    dataBase64: z
      .string()
      .min(1)
      .max(4 * Math.ceil(PROFILE_PHOTO_MAX_BYTES / 3))
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  })
  .strict();
export const profilePhotoSchema = z
  .object({
    url: z.string().url().nullable(),
    expiresAt: z.string().datetime().nullable(),
    canUpload: z.boolean(),
    notice: z.string().nullable(),
  })
  .strict();
export type ProfilePhoto = z.infer<typeof profilePhotoSchema>;
