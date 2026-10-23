import { ostAnnualExpiry } from './ost-accreditation.js';
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
import { ostIdentitySchema, ostOfficialFormSchema } from './ost-accreditation.js';
import { ostApplicationStatusSchema } from './ost.js';

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

/** The three hierarchy positions. OST is not creatable here: see positionKind. */
export const istPositionSchema = z.enum(['vice_director', 'senior_sales_manager', 'sales_manager']);
export type IstPosition = z.infer<typeof istPositionSchema>;
export const IST_POSITIONS: readonly MemberPosition[] = istPositionSchema.options;

/**
 * The accreditation category a position belongs to. Classification is derived
 * from the position (the role assignment), never stored separately, so the
 * position and its accreditation kind can never disagree.
 */
export function positionKind(position: MemberPosition): 'IST' | 'OST' {
  return position === 'ost' ? 'OST' : 'IST';
}

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
 * Operator-typed IST AA number: the official `AAI` + YYMM + sequence shape, or
 * an already-issued legacy `AA-` identifier. The kind prefix is mandatory for
 * a new number, so an OST number can never be typed onto an IST seller; legacy
 * numbers are accepted because an issued number is never renumbered.
 */
export const manualIstAaNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    (value) =>
      /^AAI\d{2}(?:0[1-9]|1[0-2])(?!0000)\d{4}$/.test(value) ||
      (/^AA-[A-Z0-9]{12}$/.test(value) && (value.slice(3).match(/[A-Z]/g) ?? []).length === 6),
    'Use AAI + YYMM + sequence, or an existing AA number',
  );

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
  /**
   * Immediate-upline link. A move must name the immediate upline of the
   * (possibly new) position, carries a reason and is audited; the database
   * trigger re-validates direction and cycles.
   */
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
    aaNumber: manualIstAaNumberSchema.optional(),
    // PSGC codes chosen from the reference lists. Required together: the
    // server re-resolves the pair and stores the authority's own names.
    provinceCode: geographicCodeSchema,
    cityMunicipalityCode: geographicCodeSchema,
  })
  .superRefine((value, ctx) => {
    // OST is never created here: it carries a different accreditation
    // footprint and its own pipeline (Create OST / a transfer).
    if (value.position === 'ost') {
      ctx.addIssue({
        code: 'custom',
        path: ['position'],
        message: 'Use Create OST for an OST member',
      });
      return;
    }
    if (value.position === 'vice_director') {
      if (value.referrerStaffId)
        ctx.addIssue({ code: 'custom', message: 'A Vice Director has no head' });
    } else if (!value.referrerStaffId) {
      ctx.addIssue({ code: 'custom', message: 'A head is required' });
    }
    if (value.position !== 'sales_manager' && value.ostReferrerStaffId) {
      ctx.addIssue({ code: 'custom', message: 'An OST referrer is for Sales Managers only' });
    }
    if (value.aaNumberMode === 'manual' && !value.aaNumber) {
      ctx.addIssue({ code: 'custom', message: 'Type the AA number' });
    } else if (value.aaNumberMode === 'auto' && value.aaNumber) {
      ctx.addIssue({ code: 'custom', message: 'Automatic mode issues the number' });
    }
  });
export type CreateMember = z.infer<typeof createMemberSchema>;

/**
 * Profile update. Every field the create form owns can be corrected here, so
 * an administrator edits a member in ONE form: position (the server
 * re-resolves the role and re-checks the hierarchy), head (a move carries a
 * reason and is audited), email (the login identity) and a temporary password
 * (an administrator reset that forces a change at the next sign-in). Address
 * codes travel together: when both are present the server re-resolves the
 * pair against the PSGC reference; without them the typed text is saved for
 * legacy rows that were never verified.
 */
export const updateMemberProfileSchema = memberProfileSchema
  .extend({
    fullName: memberFullNameSchema,
    email: emailSchema,
    temporaryPassword: z.string().min(8).max(128),
    position: memberPositionSchema,
    /** Required by the server whenever the head link actually moves. */
    headChangeReason: z.string().trim().min(3).max(200),
    provinceCode: geographicCodeSchema,
    cityMunicipalityCode: geographicCodeSchema,
  })
  .partial()
  .superRefine((value, ctx) => {
    // A kind change is a transfer, never a profile edit: it must revoke the
    // accreditation and issue the successor number in one transaction.
    if (value.position === 'ost') {
      ctx.addIssue({
        code: 'custom',
        path: ['position'],
        message: 'Use Transfer to move a member into OST',
      });
    }
  });
export type UpdateMemberProfile = z.infer<typeof updateMemberProfileSchema>;

/**
 * Issue a missing AA number (never a renumber: the handler refuses a member
 * that already holds one). Same AUTO/MANUAL rules as creation.
 */
export const issueAccreditationSchema = z
  .object({
    aaNumberMode: aaNumberModeSchema.default('auto'),
    aaNumber: manualIstAaNumberSchema.optional(),
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
  /** Immediate-upline and OST-referrer links, for the edit form's prefills. */
  referrerStaffId: z.string().uuid().nullable(),
  ostReferrerStaffId: z.string().uuid().nullable(),
  aaNumber: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  sex: z.string().nullable(),
  civilStatus: z.string().nullable(),
  streetNo: z.string().nullable(),
  cityMunicipality: z.string().nullable(),
  province: z.string().nullable(),
  /** PSGC codes chosen from the reference; null on legacy unverified rows. */
  provinceCode: z.string().nullable(),
  cityMunicipalityCode: z.string().nullable(),
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

/**
 * Direct OST creation from the Members console. The two modes are the two
 * truthful paths: `complete` states the signature evidence, the sponsor and
 * the approved validity in one act, and management (the operator) approves on
 * the spot; `pending` records the application and its provenance without
 * issuing an accreditation prematurely. Neither path records an endorsement:
 * only the sponsor can endorse, so the direct path never claims one.
 */
export const createOstMemberModeSchema = z.enum(['complete', 'pending']);
export type CreateOstMemberMode = z.infer<typeof createOstMemberModeSchema>;

export const manualOstAaNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^AAO\d{2}(?:0[1-9]|1[0-2])(?!0000)\d{4}$/, 'Use AAO + YYMM + four-digit sequence');

export const createOstMemberSchema = z
  .object({
    mode: createOstMemberModeSchema,
    temporaryPassword: z.string().min(8).max(128).optional(),
    aaNumberMode: z.enum(['auto', 'manual']).default('auto'),
    aaNumber: manualOstAaNumberSchema.optional(),
    requestId: z.string().uuid(),
    sponsorStaffId: z.string().uuid(),
    identity: ostIdentitySchema,
    form: ostOfficialFormSchema,
    /** The management-approved validity; required to complete. */
    startsOn: z.iso.date().nullable().default(null),
    expiresOn: z.iso.date().nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode !== 'complete') return;
    if (!value.temporaryPassword)
      ctx.addIssue({
        code: 'custom',
        path: ['temporaryPassword'],
        message: 'Set a temporary password',
      });
    if (value.aaNumberMode === 'manual' && !value.aaNumber)
      ctx.addIssue({ code: 'custom', path: ['aaNumber'], message: 'Enter the AA number' });
    if (value.aaNumberMode === 'auto' && value.aaNumber)
      ctx.addIssue({
        code: 'custom',
        path: ['aaNumber'],
        message: 'Choose manual mode to enter an AA number',
      });
    if (
      value.form.applicantSignatureStatus !== 'received' ||
      value.form.referrerSignatureStatus !== 'received'
    )
      ctx.addIssue({
        code: 'custom',
        path: ['form'],
        message: 'Both signatures are required to complete an OST',
      });
    if (!value.startsOn || !value.expiresOn)
      ctx.addIssue({
        code: 'custom',
        path: ['expiresOn'],
        message: 'Choose the approved start and expiry dates',
      });
    else if (value.expiresOn !== ostAnnualExpiry(value.startsOn))
      ctx.addIssue({
        code: 'custom',
        path: ['expiresOn'],
        message: 'Expiry must be on or after the approved start',
      });
  });
export type CreateOstMember = z.infer<typeof createOstMemberSchema>;

/**
 * Direct OST creation result. `memberId` is present only once the account was
 * installed, so a client can tell a saved application from a completed one.
 */
export const createOstMemberResultSchema = z
  .object({
    applicationId: z.string().uuid(),
    memberId: z.string().uuid().nullable(),
    status: ostApplicationStatusSchema,
  })
  .strict();
export type CreateOstMemberResult = z.infer<typeof createOstMemberResultSchema>;

/**
 * A transfer changes the member's accreditation KIND. It is not a profile
 * edit: it revokes the held number (kept in the accreditation history) and
 * issues a successor in one transaction, with a reason. IST -> OST must state
 * the full OST footprint (identity, official form, sponsor, validity);
 * OST -> IST must name a valid IST position and its immediate head.
 */
const transferReasonSchema = z.string().trim().min(5).max(300);

/** A genealogy move preserves OST identity, role, AA number and term dates. */
export const transferOstTeamSchema = z
  .object({
    requestId: z.string().uuid(),
    sponsorStaffId: z.string().uuid(),
    reason: transferReasonSchema,
    managementApproved: z.literal(true),
  })
  .strict();

export const transferMemberToOstSchema = z
  .object({
    direction: z.literal('IST_TO_OST'),
    requestId: z.string().uuid(),
    reason: transferReasonSchema,
    sponsorStaffId: z.string().uuid(),
    identity: ostIdentitySchema,
    form: ostOfficialFormSchema,
    startsOn: z.iso.date(),
    expiresOn: z.iso.date(),
  })
  .strict();

export const transferMemberToIstSchema = z
  .object({
    direction: z.literal('OST_TO_IST'),
    requestId: z.string().uuid(),
    reason: transferReasonSchema,
    targetPosition: istPositionSchema,
    headStaffId: z.string().uuid().nullable().default(null),
  })
  .strict();

export const transferMemberSchema = z
  .discriminatedUnion('direction', [transferMemberToOstSchema, transferMemberToIstSchema])
  .superRefine((value, ctx) => {
    if (value.direction === 'IST_TO_OST') {
      if (value.expiresOn < value.startsOn)
        ctx.addIssue({
          code: 'custom',
          path: ['expiresOn'],
          message: 'Expiry must be on or after the approved start',
        });
      if (
        value.form.applicantSignatureStatus !== 'received' ||
        value.form.referrerSignatureStatus !== 'received'
      )
        ctx.addIssue({
          code: 'custom',
          path: ['form'],
          message: 'Both signatures are required to transfer to OST',
        });
      return;
    }
    const expected = MEMBER_UPLINE_ROLE[value.targetPosition];
    if (expected ? !value.headStaffId : value.headStaffId)
      ctx.addIssue({
        code: 'custom',
        path: ['headStaffId'],
        message: expected ? 'A head is required' : 'A Vice Director has no head',
      });
  });
export type TransferMember = z.infer<typeof transferMemberSchema>;
export type TransferMemberToOst = z.infer<typeof transferMemberToOstSchema>;
export type TransferMemberToIst = z.infer<typeof transferMemberToIstSchema>;
