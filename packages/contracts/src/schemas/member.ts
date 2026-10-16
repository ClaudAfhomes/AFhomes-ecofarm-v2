import { z } from 'zod';

import {
  dateOfBirthSchema,
  emailSchema,
  normalizePersonName,
  optionalLandlineSchema,
  PERSON_NAME_RE,
  phoneSchema,
  toTitleCase,
} from './input.js';
import { geographicCodeSchema } from './address.js';
import { governmentIdTypeSchema } from './sales.js';

/**
 * Member TIN: exactly 9 digits, no dashes or branch suffixes. Stricter than
 * the shared application TIN on purpose: the member form filters to
 * digits-only live, so the contract matches the field instead of disagreeing
 * with it.
 */
const memberTinSchema = z.preprocess(
  (value) =>
    value == null || (typeof value === 'string' && value.trim() === '') ? undefined : value,
  z
    .string()
    .trim()
    .regex(/^\d{9}$/, 'Use the 9-digit TIN')
    .optional(),
);

/**
 * AFHomes sales-network Members: hierarchy sellers (Vice Director, Senior
 * Sales Manager, Sales Manager) and OSTs onboarded with a full personal
 * record. A Member IS a staff account - creation provisions the login - with
 * the extra form fields stored on a linked profile row.
 *
 * The head chain is Vice Director -> Senior Sales Manager -> Sales Manager
 * -> OST. The head picker lists the immediate-upline holders for the chosen
 * position; a Vice Director has no head. Separately, a Sales Manager may
 * name an OST referrer (informational only, never a genealogy edge).
 */

/** Positions a Member can hold. The value is the staff role slug. */
export const memberPositionSchema = z.enum([
  'vice_director',
  'senior_sales_manager',
  'sales_manager',
  'ost',
]);
export type MemberPosition = z.infer<typeof memberPositionSchema>;

export const MEMBER_POSITIONS: readonly MemberPosition[] = [
  'vice_director',
  'senior_sales_manager',
  'sales_manager',
  'ost',
];

/** User-facing labels. The client sends slugs; labels are display only. */
export const MEMBER_POSITION_LABELS: Record<MemberPosition, string> = {
  vice_director: 'Sales Vice Director',
  senior_sales_manager: 'Senior Sales Manager',
  sales_manager: 'Sales Manager',
  ost: 'OST',
};

/**
 * Immediate-upline role per position. A Vice Director has no upline, so the
 * referrer section is hidden for that position. Enforced server-side with
 * `hierarchyAllowsUpline`; this map only drives the picker.
 */
export const MEMBER_UPLINE_ROLE: Record<MemberPosition, MemberPosition | null> = {
  vice_director: null,
  senior_sales_manager: 'vice_director',
  sales_manager: 'senior_sales_manager',
  ost: 'sales_manager',
};

/** Member sex pick-list: the Male/Female subset of the application vocabulary. */
export const memberSexSchema = z.enum(['Male', 'Female']);
export type MemberSex = z.infer<typeof memberSexSchema>;

/** Member civil-status pick-list: the four stated values, never invented. */
export const memberCivilStatusSchema = z.enum(['Single', 'Married', 'Widowed', 'Separated']);
export type MemberCivilStatus = z.infer<typeof memberCivilStatusSchema>;

/** How the AA number is set: system-issued or operator-typed. */
export const aaNumberModeSchema = z.enum(['auto', 'manual']);
export type AaNumberMode = z.infer<typeof aaNumberModeSchema>;

/**
 * Operator-typed AA number: `AA` plus 4 to 12 uppercase letters/digits
 * (6 to 14 characters total, no separators). Composition is the generator's
 * business, not a rejection rule: typed numbers are checked for shape and
 * uniqueness, never for internal arrangement.
 */
export const manualAaNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^AA[A-Z0-9]{4,12}$/, 'Use AA plus up to 12 letters/digits');

/** Staff display name: letters/spaces/apostrophes/hyphens, stored UPPERCASE. */
const memberFullNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(PERSON_NAME_RE, 'Use letters, spaces, apostrophes and hyphens only - no numbers')
  .transform((value) => normalizePersonName(value));

const addressText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((value) => toTitleCase(value));

/**
 * The linked profile record. TIN and the government ID number are write-only:
 * accepted on create/update, stored, masked on every read, never in audits.
 * Age is derived from the birth date at display time and is never stored.
 */
export const memberProfileSchema = z.object({
  dateOfBirth: dateOfBirthSchema,
  sex: memberSexSchema,
  civilStatus: memberCivilStatusSchema,
  streetNo: addressText(120),
  cityMunicipality: addressText(100),
  province: addressText(100),
  zipCode: z.string().trim().min(1).max(10),
  telNo: optionalLandlineSchema,
  mobileNo: phoneSchema,
  fbMessenger: z.string().trim().max(80).optional(),
  tin: memberTinSchema,
  employerName: z.string().trim().min(1).max(120),
  employerAddress: addressText(200),
  jobPosition: z.string().trim().min(1).max(80),
  governmentIdType: governmentIdTypeSchema,
  governmentIdNumber: z
    .string()
    .trim()
    .min(4)
    .max(16)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits and dashes only'),
  /** Immediate-upline link. Head changes go through the upline desk. */
  referrerStaffId: z.string().uuid().nullable().optional(),
  /**
   * Informational OST referrer, Sales Manager onboarding only. Never a
   * genealogy edge: the OST sits below the Sales Manager in the hierarchy.
   */
  ostReferrerStaffId: z.string().uuid().nullable().optional(),
});
export type MemberProfile = z.infer<typeof memberProfileSchema>;

/**
 * Member creation: account identity plus the full profile. The client sends
 * the position slug; the server resolves the role row, so a tampered role id
 * cannot escalate. The confirm-password field is client-only. Every position
 * except Vice Director names its head; a Vice Director names none. The OST
 * referrer rides along only for Sales Managers and is optional.
 */
export const createMemberSchema = memberProfileSchema
  .extend({
    fullName: memberFullNameSchema,
    email: emailSchema,
    temporaryPassword: z.string().min(8).max(128),
    departmentId: z.string().uuid(),
    position: memberPositionSchema,
    aaNumberMode: aaNumberModeSchema.default('auto'),
    aaNumber: manualAaNumberSchema.optional(),
    // PSGC codes chosen from the reference lists. Required together: the
    // server re-resolves the pair and stores the authority's own names.
    provinceCode: geographicCodeSchema,
    cityMunicipalityCode: geographicCodeSchema,
  })
  .superRefine((value, ctx) => {
    if (value.position === 'vice_director') {
      if (value.referrerStaffId)
        ctx.addIssue({ code: 'custom', message: 'A Vice Director has no head' });
    } else if (!value.referrerStaffId) {
      ctx.addIssue({ code: 'custom', message: 'A head is required' });
    }
    if (value.position !== 'sales_manager' && value.ostReferrerStaffId) {
      ctx.addIssue({ code: 'custom', message: 'An OST referrer is for Sales Managers only' });
    }
    if (value.position === 'ost' && value.aaNumberMode === 'manual') {
      ctx.addIssue({ code: 'custom', message: 'OST numbers ride the approval flow' });
    } else if (value.aaNumberMode === 'manual' && !value.aaNumber) {
      ctx.addIssue({ code: 'custom', message: 'Type the AA number' });
    } else if (value.aaNumberMode === 'auto' && value.aaNumber) {
      ctx.addIssue({ code: 'custom', message: 'Automatic mode issues the number' });
    }
  });
export type CreateMember = z.infer<typeof createMemberSchema>;

/** Profile update. The head link is deliberately absent (upline desk owns it). */
export const updateMemberProfileSchema = memberProfileSchema
  .omit({ referrerStaffId: true })
  .extend({ fullName: memberFullNameSchema.optional() })
  .partial();
export type UpdateMemberProfile = z.infer<typeof updateMemberProfileSchema>;

/**
 * Issue a missing AA number (never a renumber: the handler refuses a member
 * that already holds one). Same AUTO/MANUAL rules as creation.
 */
export const issueAccreditationSchema = z
  .object({
    aaNumberMode: aaNumberModeSchema.default('auto'),
    aaNumber: manualAaNumberSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.aaNumberMode === 'manual' && !value.aaNumber) {
      ctx.addIssue({ code: 'custom', message: 'Type the AA number' });
    } else if (value.aaNumberMode === 'auto' && value.aaNumber) {
      ctx.addIssue({ code: 'custom', message: 'Automatic mode issues the number' });
    }
  });
export type IssueAccreditation = z.infer<typeof issueAccreditationSchema>;

/** List-shaped read model. Secrets are masked; the plaintext exists only at submission. */
export const memberSchema = z.object({
  id: z.string().uuid(),
  employeeNumber: z.string().nullable(),
  fullName: z.string(),
  email: z.string(),
  position: memberPositionSchema,
  positionLabel: z.string(),
  departmentName: z.string().nullable(),
  status: z.string(),
  referrerName: z.string().nullable(),
  ostReferrerName: z.string().nullable(),
  aaNumber: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  sex: z.string().nullable(),
  civilStatus: z.string().nullable(),
  streetNo: z.string().nullable(),
  cityMunicipality: z.string().nullable(),
  province: z.string().nullable(),
  zipCode: z.string().nullable(),
  telNo: z.string().nullable(),
  mobileNo: z.string().nullable(),
  fbMessenger: z.string().nullable(),
  employerName: z.string().nullable(),
  employerAddress: z.string().nullable(),
  jobPosition: z.string().nullable(),
  governmentIdType: z.string().nullable(),
  tinMasked: z.string().nullable(),
  governmentIdMasked: z.string().nullable(),
  createdAt: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

/**
 * Single-member read for the members console. Unlike the list, it carries the
 * two identification fields an administrator typed so the operator can verify
 * them. The read stays behind the members permission; neither value ever
 * reaches an audit payload.
 */
export const memberDetailSchema = memberSchema.extend({
  tin: z.string().nullable(),
  governmentIdNumber: z.string().nullable(),
});
export type MemberDetail = z.infer<typeof memberDetailSchema>;

export const memberListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  position: memberPositionSchema.optional(),
});
export type MemberListQuery = z.infer<typeof memberListQuerySchema>;
