import { z } from 'zod';

export const publicVerificationFieldsSchema = z.object({
  enabled: z.boolean(),
  dailyLimitEnabled: z.boolean().default(true),
  privacyApproved: z.boolean().default(false),
  verificationPhone: z
    .string()
    .trim()
    .regex(/^\+?[\d ()-]{7,30}$/, 'Enter a valid verification phone.'),
  privacyNotice: z
    .string()
    .trim()
    .min(100)
    .max(20000)
    .refine((value) => !/\[Insert|\bTBD\b/.test(value), 'Use a finalized privacy notice.'),
  retentionDays: z.number().int().min(1).max(3650),
});
export const publicVerificationSettingsSchema = publicVerificationFieldsSchema.extend({
  cleanupReady: z.boolean().default(false),
  noticeVersion: z.string().min(1).max(100),
  revision: z.number().int().positive(),
  updatedAt: z.string(),
});
export const updatePublicVerificationSettingsSchema = publicVerificationFieldsSchema
  .extend({
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type PublicVerificationSettings = z.infer<typeof publicVerificationSettingsSchema>;
export type UpdatePublicVerificationSettings = z.infer<
  typeof updatePublicVerificationSettingsSchema
>;
