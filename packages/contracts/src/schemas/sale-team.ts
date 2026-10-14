import { z } from 'zod';

export const aaNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(64)
  .regex(/^AA-[A-Z0-9]{12}$/)
  .refine(
    (value) => (value.slice(3).match(/[A-Z]/g) ?? []).length === 6,
    'Use six letters and six digits.',
  );
export const saleTeamKindSchema = z.enum(['IST', 'OST']);
export const saleTeamAccreditationSchema = z
  .object({
    aaNumber: aaNumberSchema,
    kind: saleTeamKindSchema,
    fullName: z.string(),
    status: z.enum(['accredited', 'expired', 'revoked', 'inactive', 'not_started']),
    startsOn: z.iso.date(),
    expiresOn: z.iso.date(),
  })
  .strict();
export const saleTeamLookupSchema = saleTeamAccreditationSchema.nullable();
export const manageSaleTeamSchema = z
  .object({
    action: z.enum(['approve', 'revoke']),
    kind: saleTeamKindSchema,
    startsOn: z.iso.date().optional(),
    expiresOn: z.iso.date().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.action === 'approve' &&
      value.kind === 'IST' &&
      (!value.startsOn || !value.expiresOn || value.expiresOn < value.startsOn)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Choose approved start and expiry dates.' });
    }
  });
export type SaleTeamAccreditation = z.infer<typeof saleTeamAccreditationSchema>;
