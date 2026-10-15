import { z } from 'zod';

export const aaNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(64)
  .refine(
    (value) =>
      /^AA[IO]\d{2}(?:0[1-9]|1[0-2])(?!0000)\d{4}$/.test(value) ||
      (/^AA-[A-Z0-9]{12}$/.test(value) && (value.slice(3).match(/[A-Z]/g) ?? []).length === 6),
    'Use an AAI/AAO number with a valid month and sequence, or an existing AA number.',
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
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.aaNumber.startsWith('AAI') && value.kind !== 'IST') ||
      (value.aaNumber.startsWith('AAO') && value.kind !== 'OST')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['aaNumber'],
        message: 'AA prefix must match seller kind.',
      });
    }
  });
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
