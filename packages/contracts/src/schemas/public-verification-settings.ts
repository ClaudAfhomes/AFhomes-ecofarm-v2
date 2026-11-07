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
  supportHeading: z.string().trim().min(1).max(200).default('Customer Support & Payment Inquiries'),
  supportEmail: z.string().trim().email('Enter a valid email.').default('info@afhomes.com.ph'),
  supportPhone: z.string().trim().regex(/^\+?[\d ()-]{7,30}$/, 'Enter a valid phone.').default('+63 960 431 6867'),
  bankHolder: z.string().trim().min(1).max(200).default('AFhomes Hotspring & Ecofarm Resort Corp.'),
  bank1Name: z.string().trim().min(1).max(100).default('SECURITY BANK'),
  bank1Account: z.string().trim().min(1).max(50).default('0000082595577'),
  bank2Name: z.string().trim().min(1).max(100).default('CHINABANK'),
  bank2Account: z.string().trim().min(1).max(50).default('150700006468'),
  checkPayee: z.string().trim().min(1).max(200).default('AFhomes Hotspring & Ecofarm Resort Corp.'),
  bankReminder: z.string().trim().min(1).max(500).default('Please double-check the provided company bank account details before sending any payment. Thank you!'),
  agentReminder: z.string().trim().min(1).max(500).default('A friendly reminder: All agents are strictly prohibited from directly collecting payments from buyers.'),
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
