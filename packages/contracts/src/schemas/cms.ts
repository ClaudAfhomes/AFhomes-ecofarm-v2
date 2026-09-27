import { z } from 'zod';

export const cmsDocumentKeySchema = z.enum([
  'site',
  'pageContent',
  'experiences',
  'vip',
  'faq',
  'stories',
  'mediaBlocks',
]);
export type CmsDocumentKey = z.infer<typeof cmsDocumentKeySchema>;

export const cmsPublishStateSchema = z.enum(['draft', 'published']);
export const cmsJsonObjectSchema = z.record(z.string(), z.unknown());

export const cmsDocumentSchema = z.object({
  key: cmsDocumentKeySchema,
  draftValue: z.unknown(),
  publishedValue: z.unknown().nullable(),
  status: cmsPublishStateSchema,
  version: z.number().int().positive(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export const updateCmsDocumentSchema = z.object({
  value: z.unknown(),
  expectedVersion: z.number().int().positive(),
  changeSummary: z.string().trim().min(3).max(500),
});

export const cmsBlockTypeSchema = z.enum([
  'hero',
  'rich-text',
  'image',
  'gallery',
  'video',
  'two-column',
  'features',
  'services',
  'testimonials',
  'faq',
  'cta',
  'contact',
  'map',
  'divider',
]);

export const cmsSectionSchema = z.object({
  id: z.string().uuid().optional(),
  blockType: cmsBlockTypeSchema,
  content: cmsJsonObjectSchema,
  sortOrder: z.number().int().nonnegative(),
  isVisible: z.boolean(),
});

export const cmsSeoSchema = z.object({
  title: z.string().trim().max(200).default(''),
  description: z.string().trim().max(500).default(''),
  openGraphTitle: z.string().trim().max(200).default(''),
  openGraphDescription: z.string().trim().max(500).default(''),
  openGraphImage: z.string().trim().max(2000).default(''),
});

export const cmsPageSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  status: cmsPublishStateSchema,
  seo: cmsSeoSchema,
  sections: z.array(cmsSectionSchema),
  version: z.number().int().positive(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createCmsPageSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(200),
  seo: cmsSeoSchema.default({
    title: '',
    description: '',
    openGraphTitle: '',
    openGraphDescription: '',
    openGraphImage: '',
  }),
  sections: z.array(cmsSectionSchema).max(100).default([]),
  changeSummary: z.string().trim().min(3).max(500),
});

export const updateCmsPageSchema = createCmsPageSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
  changeSummary: z.string().trim().min(3).max(500),
});

export const cmsHistorySchema = z.object({
  id: z.string(),
  entityType: z.enum(['document', 'page']),
  entityId: z.string(),
  action: z.string(),
  changeSummary: z.string(),
  version: z.number().int().positive(),
  authorId: z.string().uuid(),
  authorName: z.string(),
  createdAt: z.string(),
});

export const cmsMediaSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  storagePath: z.string(),
  publicUrl: z.string(),
  mimeType: z.string(),
  mediaType: z.enum(['image', 'video']),
  altText: z.string(),
  category: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export const createCmsMediaSchema = z.object({
  name: z.string().trim().min(1).max(180),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4']),
  altText: z.string().trim().max(500).default(''),
  category: z.string().trim().min(1).max(60).default('general'),
  dataBase64: z.string().min(1),
});

export const cmsPublicContentSchema = z.object({
  documents: z.record(z.string(), z.unknown()),
  revision: z.string(),
});

export type CmsDocument = z.infer<typeof cmsDocumentSchema>;
export type CmsPage = z.infer<typeof cmsPageSchema>;
export type CmsSection = z.infer<typeof cmsSectionSchema>;
export type CmsHistory = z.infer<typeof cmsHistorySchema>;
export type CmsMedia = z.infer<typeof cmsMediaSchema>;
export type CmsPublicContent = z.infer<typeof cmsPublicContentSchema>;
