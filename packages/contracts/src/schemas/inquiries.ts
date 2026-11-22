import { z } from 'zod';

import { emailSchema, normalizePersonName, normalizePhilippinePhone, PERSON_NAME_RE } from './input.js';

/**
 * Website inquiries (migration 20270105000027).
 *
 * The public contact/reservation form posts here; staff work the inbox in the
 * admin console. A website "reservation" is a REQUEST to be contacted about a
 * visit, never a booking: nothing here holds a room, takes money or creates a
 * customer.
 */

export const INQUIRY_TOPICS = [
  'VIP Privilege',
  'Smart Wellness Hotel',
  'ALM Japanese Restaurant',
  'Hotspring & Ecofarm Resort',
  'General Inquiry',
] as const;
export const inquiryTopicSchema = z.enum(INQUIRY_TOPICS);

export const inquiryKindSchema = z.enum(['inquiry', 'reservation']);
export type InquiryKind = z.infer<typeof inquiryKindSchema>;

/** `spam` keeps the row (nothing is deleted) but takes it out of the working list. */
export const INQUIRY_STATUSES = ['new', 'contacted', 'confirmed', 'closed', 'spam'] as const;
export const inquiryStatusSchema = z.enum(INQUIRY_STATUSES);
export type InquiryStatus = z.infer<typeof inquiryStatusSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

/**
 * Visitors may be abroad, so a non-PH number is accepted as typed; letters are
 * refused, and a PH mobile is stored in the canonical +63 form.
 */
const contactNumberSchema = z
  .string()
  .trim()
  .min(7, 'Enter a contact number.')
  .max(30)
  .regex(/^\+?[0-9 ()\-]+$/, 'Use digits only (spaces, dashes, brackets and a leading + are fine).')
  .refine((value) => {
    const digits = value.replace(/\D/g, '').length;
    return digits >= 7 && digits <= 15;
  }, 'Enter a contact number with 7 to 15 digits.')
  .transform((value) => normalizePhilippinePhone(value) ?? value);

const visitorNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter your name.')
  .max(150)
  .regex(PERSON_NAME_RE, 'Use letters, spaces, apostrophes and hyphens only - no numbers')
  .transform((value) => normalizePersonName(value));

/** Public submission. `website` is the honeypot: a person never fills it. */
export const submitInquirySchema = z
  .object({
    requestId: z.string().uuid(),
    kind: inquiryKindSchema.default('inquiry'),
    name: visitorNameSchema,
    email: emailSchema,
    contactNumber: contactNumberSchema,
    inquiryType: inquiryTopicSchema,
    message: z.string().trim().min(10, 'Tell us a little more (at least 10 characters).').max(5000),
    visitDate: isoDate.optional(),
    endDate: isoDate.optional(),
    guests: z.number().int().min(1).max(100).optional(),
    website: z.string().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'reservation' && (!value.visitDate || !value.guests))
      ctx.addIssue({
        code: 'custom',
        path: ['visitDate'],
        message: 'Choose your visit date and number of guests.',
      });
    if (value.endDate && !value.visitDate)
      ctx.addIssue({ code: 'custom', path: ['visitDate'], message: 'Choose your visit date.' });
    if (value.endDate && value.visitDate && value.endDate < value.visitDate)
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must be on or after the visit date.',
      });
  });
export type SubmitInquiryInput = z.input<typeof submitInquirySchema>;

export const submitInquiryResultSchema = z.object({ reference: z.string() });
export type SubmitInquiryResult = z.infer<typeof submitInquiryResultSchema>;

export const inquirySchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  kind: inquiryKindSchema,
  inquiryType: inquiryTopicSchema,
  name: z.string(),
  email: z.string(),
  contactNumber: z.string(),
  message: z.string(),
  visitDate: z.string().nullable(),
  endDate: z.string().nullable(),
  guests: z.number().int().nullable(),
  status: inquiryStatusSchema,
  staffNotes: z.string(),
  assignedTo: z.string().uuid().nullable(),
  assignedToName: z.string().nullable(),
  handledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Inquiry = z.infer<typeof inquirySchema>;

export const inquiryListQuerySchema = z.object({
  /** `open` = new + contacted + confirmed (the working list). */
  status: z.enum(['open', 'all', ...INQUIRY_STATUSES]).default('open'),
  kind: inquiryKindSchema.optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type InquiryListQuery = z.input<typeof inquiryListQuerySchema>;

/** Staff update: any subset; at least one field. `assignToMe` avoids sending ids. */
export const updateInquirySchema = z
  .object({
    status: inquiryStatusSchema.optional(),
    staffNotes: z.string().max(5000).optional(),
    assignToMe: z.boolean().optional(),
    unassign: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.')
  .refine((v) => !(v.assignToMe && v.unassign), 'Choose assign or unassign, not both.');
export type UpdateInquiryInput = z.infer<typeof updateInquirySchema>;
