import { z } from 'zod';

/** Explicitly public website media. Private business files use the object store. */
export const publicMediaStatusSchema = z.enum(['published', 'unpublished']);
export const publicMediaTypeSchema = z.enum(['image', 'document']);

export const publicMediaSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  publicUrl: z.string(),
  mimeType: z.string(),
  mediaType: publicMediaTypeSchema,
  altText: z.string(),
  category: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  status: publicMediaStatusSchema,
  uploadedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const updatePublicMediaSchema = z
  .object({
    altText: z.string().trim().max(500).optional(),
    category: z.string().trim().min(1).max(60).optional(),
    status: publicMediaStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const publicMediaUploadMetaSchema = z.object({
  name: z.string().trim().min(1).max(180),
  altText: z.string().trim().max(500).default(''),
  category: z.string().trim().min(1).max(60).default('general'),
});

export const deletePublicMediaSchema = z.object({ deleted: z.literal(true) });

export type PublicMedia = z.infer<typeof publicMediaSchema>;
export type PublicMediaStatus = z.infer<typeof publicMediaStatusSchema>;
export type PublicMediaType = z.infer<typeof publicMediaTypeSchema>;
