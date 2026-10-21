import { z } from 'zod';
import { emailSchema, personNameSchema, phoneSchema } from './input.js';

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
    startsOn: z.iso.date().nullable(),
    expiresOn: z.iso.date().nullable(),
    photoUrl: z.string().nullable().default(null),
  })
  .strict()
  .superRefine(prefixMatchesKind)
  .superRefine((value, ctx) => {
    if (value.kind === 'OST' && (!value.startsOn || !value.expiresOn))
      ctx.addIssue({ code: 'custom', message: 'OST accreditation requires approved dates.' });
  });

/**
 * A number that is no longer current because its holder was transferred to the
 * other kind. The successor is the number in force today; it is null only when
 * the holder has since been revoked. This is the whole historical surface: no
 * audit data, no staff id, no reason - a verification answer, not a dossier.
 */
export const saleTeamHistoricalAccreditationSchema = z
  .object({
    aaNumber: aaNumberSchema,
    kind: saleTeamKindSchema,
    fullName: z.string(),
    status: z.literal('superseded'),
    startsOn: z.iso.date().nullable(),
    expiresOn: z.iso.date().nullable(),
    photoUrl: z.string().nullable().default(null),
    successorAaNumber: aaNumberSchema.nullable(),
  })
  .strict()
  .superRefine(prefixMatchesKind);

function prefixMatchesKind(value: { aaNumber: string; kind: 'IST' | 'OST' }, ctx: z.RefinementCtx) {
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
}

export const saleTeamLookupSchema = saleTeamAccreditationSchema.nullable();
/** The public search answer: the current record, a superseded one, or null. */
export const saleTeamSearchResultSchema = z
  .union([saleTeamAccreditationSchema, saleTeamHistoricalAccreditationSchema])
  .nullable();
export const manageSaleTeamSchema = z
  .object({
    action: z.enum(['approve', 'revoke']),
    kind: saleTeamKindSchema,
    startsOn: z.iso.date().optional(),
    expiresOn: z.iso.date().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'IST' && value.action === 'revoke')
      ctx.addIssue({ code: 'custom', message: 'Use the employee access/deactivation workflow.' });
    if (value.startsOn && value.expiresOn && value.expiresOn < value.startsOn)
      ctx.addIssue({ code: 'custom', message: 'Expiry cannot precede start.' });
  });
export type SaleTeamAccreditation = z.infer<typeof saleTeamAccreditationSchema>;

export const saleTeamSearchContactSchema = z
  .object({
    name: personNameSchema,
    email: emailSchema,
    mobile: phoneSchema,
  })
  .strict();
export const saleTeamSearchStartSchema = z
  .object({
    aaNumber: aaNumberSchema,
    sessionId: z.uuid(),
    captchaToken: z.string().min(1).max(2048),
  })
  .strict();
export const saleTeamSearchRevealSchema = z
  .object({
    sessionId: z.uuid(),
    searchToken: z.string().min(1).max(4096),
    noticeVersion: z.string().min(1).max(100),
    acknowledged: z.literal(true),
    contact: saleTeamSearchContactSchema.optional(),
    contactReceipt: z.string().min(1).max(4096).optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.contact) !== Boolean(v.contactReceipt),
    'Provide contact details or a session receipt.',
  );
export const publicSaleTeamSearchResultSchema = z
  .object({
    aaNumber: aaNumberSchema,
    kind: saleTeamKindSchema,
    status: z.literal('accredited'),
    maskedName: z.string().min(1).max(250),
    expiresOn: z.iso.date().nullable(),
    photoUrl: z.url().nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    prefixMatchesKind(v, ctx);
    if (v.kind === 'OST' && !v.expiresOn)
      ctx.addIssue({ code: 'custom', message: 'OST expiry is required.' });
  });
export const saleTeamSearchConfigSchema = z
  .object({
    available: z.boolean(),
    localPreview: z.boolean(),
    noticeVersion: z.string(),
    privacyNotice: z.string(),
    verificationPhone: z.string(),
    siteKey: z.string(),
  })
  .strict();
export const saleTeamSearchStartedSchema = z.object({ searchToken: z.string() }).strict();
export const saleTeamSearchRevealedSchema = z
  .object({
    result: publicSaleTeamSearchResultSchema.nullable(),
    contactReceipt: z.string(),
  })
  .strict();
export type SaleTeamSearchContact = z.infer<typeof saleTeamSearchContactSchema>;
export type PublicSaleTeamSearchResult = z.infer<typeof publicSaleTeamSearchResultSchema>;
export type SaleTeamSearchConfig = z.infer<typeof saleTeamSearchConfigSchema>;
