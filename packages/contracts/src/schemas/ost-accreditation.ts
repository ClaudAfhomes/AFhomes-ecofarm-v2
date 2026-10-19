import { z } from 'zod';
import { submitOstApplicationSchema } from './ost.js';
import { governmentIdTypeSchema, customerAddressSchema } from './sales.js';
import { addressHierarchySchema, geographicCodeSchema } from './address.js';
import { PERSON_NAME_RE, birthDateSchema, phoneSchema } from './input.js';

const date = z.iso.date();
/** User-approved policy: calendar year, clamping leap day to the next February end. */
export function ostAnnualExpiry(start: string): string {
  if (!date.safeParse(start).success) return '';
  const value = new Date(`${start}T00:00:00.000Z`);
  const month = value.getUTCMonth();
  value.setUTCFullYear(value.getUTCFullYear() + 1);
  if (value.getUTCMonth() !== month) value.setUTCDate(0);
  return value.toISOString().slice(0, 10);
}
/** User-approved policy: the next term starts strictly after the prior expiry (inclusive expiry). */
export function ostRenewalEarliestStart(priorExpiry: string): string {
  if (!date.safeParse(priorExpiry).success) return '';
  const value = new Date(`${priorExpiry}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
const optionalText = z.string().trim().max(200).default('');
export const ostOfficialFormSchema = z
  .object({
    dateApplied: date,
    programCategory: z.enum(['vip_holder', 'non_vip', 'future_vip']),
    vipCardType: z.enum(['BRONZE', 'SILVER', 'GOLD']).nullable().default(null),
    sex: z.enum(['female', 'male', 'prefer_not_to_say']),
    civilStatus: z.enum(['single', 'married', 'widowed', 'separated']),
    telephone: optionalText,
    messenger: optionalText,
    tin: optionalText,
    employerName: optionalText,
    employerAddress: optionalText,
    jobPosition: optionalText,
    governmentIdType: governmentIdTypeSchema,
    governmentIdNumber: z.string().trim().min(1).max(100),
    applicantSignatureStatus: z.enum(['pending', 'received']),
    referrerSignatureStatus: z.enum(['pending', 'received']),
    applicantSignedOn: date.nullable().default(null),
    referrerSignedOn: date.nullable().default(null),
    referrerSnapshot: z
      .object({
        telephone: optionalText,
        mobile: optionalText,
        address: optionalText,
        messenger: optionalText,
      })
      .strict()
      .default({ telephone: '', mobile: '', address: '', messenger: '' }),
  })
  .strict()
  .superRefine((form, ctx) => {
    if (form.dateApplied > new Date().toISOString().slice(0, 10))
      ctx.addIssue({
        code: 'custom',
        path: ['dateApplied'],
        message: 'Date applied cannot be in the future',
      });
    if (form.programCategory === 'vip_holder' && !form.vipCardType)
      ctx.addIssue({
        code: 'custom',
        path: ['vipCardType'],
        message: 'Choose the existing VIP card tier',
      });
    for (const [status, field] of [
      [form.applicantSignatureStatus, 'applicantSignedOn'],
      [form.referrerSignatureStatus, 'referrerSignedOn'],
    ] as const) {
      const signed = form[field];
      if (status === 'received' && (!signed || signed > form.dateApplied))
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Provide the signature date, on or before the application date',
        });
    }
  });

export const ostIdentitySchema = submitOstApplicationSchema
  .omit({ referralCode: true })
  .extend({
    // Legacy imports may lack official codes; supplied codes are always re-verified server-side.
    addressHierarchy: addressHierarchySchema
      .extend({ regionCode: geographicCodeSchema.optional() })
      .strict()
      .optional(),
  })
  .strict();
export const submitOstAccreditationSchema = z
  .object({
    requestId: z.string().uuid(),
    referralCode: z.string().trim().min(8).max(64),
    identity: ostIdentitySchema,
    form: ostOfficialFormSchema,
  })
  .strict();
export const manualOstAccreditationSchema = submitOstAccreditationSchema
  .omit({ referralCode: true })
  .extend({ sponsorStaffId: z.string().uuid() })
  .strict();
export const approveOstAccreditationSchema = z
  .object({
    startsOn: date,
    expiresOn: date,
    temporaryPassword: z.string().min(8).max(128).optional(),
  })
  .strict()
  .refine((v) => v.expiresOn >= v.startsOn, {
    path: ['expiresOn'],
    message: 'Expiry must be on or after the approved start',
  });
export const submitOstRenewalSchema = z
  .object({
    requestId: z.string().uuid(),
    dateOfRenewal: date,
    requestedStart: date,
    requestedEnd: date,
    proposedNewSponsorStaffId: z.string().uuid().nullable().default(null),
    reasonForReferrerChange: z.string().trim().max(500).default(''),
    applicantSignatureStatus: z.enum(['pending', 'received']),
    referrerSignatureStatus: z.enum(['pending', 'received']),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.requestedEnd < v.requestedStart)
      ctx.addIssue({
        code: 'custom',
        path: ['requestedEnd'],
        message: 'Expiry must be on or after the start',
      });
    else if (v.requestedEnd !== ostAnnualExpiry(v.requestedStart))
      ctx.addIssue({
        code: 'custom',
        path: ['requestedEnd'],
        message: 'OST renewal must last one calendar year',
      });
    if (v.proposedNewSponsorStaffId && v.reasonForReferrerChange.length < 5)
      ctx.addIssue({
        code: 'custom',
        path: ['reasonForReferrerChange'],
        message: 'Explain the proposed referrer change',
      });
  });
export const ostRenewalDecisionSchema = z
  .object({
    action: z.enum(['endorse', 'approve', 'reject', 'request-changes']),
    notes: z.string().trim().max(500).default(''),
  })
  .strict();
/**
 * Controlled applicant correction ("Update Information"). The operator submits
 * the registered values it wants the account to carry; the server records only
 * the fields that actually changed. `fullName`, `birthDate`, `sex` and
 * `civilStatus` are sensitive identity changes and require a reason. Email is
 * the login identity and the program/VIP state is authoritative, so neither is
 * editable here. The address pair is optional: when present, both the address
 * and its reference codes travel together and the server re-verifies them.
 */
const updateOstHierarchySchema = addressHierarchySchema
  .extend({ regionCode: geographicCodeSchema })
  .strict();
export const updateOstApplicantSchema = z
  .object({
    requestId: z.string().uuid(),
    fullName: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .regex(PERSON_NAME_RE, 'Use letters, spaces, apostrophes and hyphens only - no numbers'),
    birthDate: birthDateSchema,
    phone: phoneSchema,
    sex: z.enum(['female', 'male', 'prefer_not_to_say']),
    civilStatus: z.enum(['single', 'married', 'widowed', 'separated']),
    address: customerAddressSchema.optional(),
    addressHierarchy: updateOstHierarchySchema.optional(),
    messenger: optionalText,
    employerName: optionalText,
    jobPosition: optionalText,
    reason: z.string().trim().max(500).default(''),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.address === undefined) !== (value.addressHierarchy === undefined))
      ctx.addIssue({
        code: 'custom',
        path: [value.address === undefined ? 'address' : 'addressHierarchy'],
        message: 'Provide the address and its reference codes together',
      });
  });

export type OstOfficialForm = z.infer<typeof ostOfficialFormSchema>;
export type OstIdentity = z.infer<typeof ostIdentitySchema>;
export type SubmitOstAccreditation = z.infer<typeof submitOstAccreditationSchema>;
export type ManualOstAccreditation = z.infer<typeof manualOstAccreditationSchema>;
export type SubmitOstRenewal = z.infer<typeof submitOstRenewalSchema>;
export type UpdateOstApplicant = z.infer<typeof updateOstApplicantSchema>;

export const ostMutationResultSchema = z.object({ id: z.string().uuid() });
/**
 * Applicant snapshot recorded at submission (frozen history) or projected as the
 * current registered values. `programCategory` is authoritative: no linked
 * customer is `unknown`, never an invented VIP claim. `tinMasked` is the only
 * government ID value ever exposed.
 */
export const ostApplicantSnapshotSchema = z.object({
  fullName: z.string(),
  birthDate: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  sex: z.string().nullable(),
  civilStatus: z.string().nullable(),
  address: z.record(z.string(), z.unknown()).nullable(),
  messenger: z.string().nullable(),
  employerName: z.string().nullable(),
  jobPosition: z.string().nullable(),
  tinMasked: z.string().nullable(),
  programCategory: z.enum(['unknown', 'vip_holder', 'non_vip']),
  vipCardType: z.string().nullable(),
});
export const ostFileSchema = z.object({
  filename: z.string().min(1),
  mime: z.string().min(1),
  content: z.string().min(1),
});
export const ostAccreditationRecordsSchema = z.object({
  registration: z
    .object({
      form_number: z.string(),
      date_applied: z.string(),
      program_category: z.string(),
      vip_card_type: z.string().nullable(),
      applicant_signature_status: z.string(),
      referrer_signature_status: z.string(),
      endorsed_at: z.string().nullable(),
      official_details: z.record(z.string(), z.unknown()),
    })
    .nullable(),
  /** Current registered applicant projection; null when no registered record exists. */
  currentApplicant: ostApplicantSnapshotSchema.nullable(),
  terms: z.array(
    z.object({
      id: z.string().uuid(),
      starts_on: z.string(),
      expires_on: z.string(),
      displayStatus: z.enum(['active', 'expired', 'superseded', 'revoked']),
      approved_at: z.string(),
    }),
  ),
  renewals: z.array(
    z.object({
      id: z.string().uuid(),
      renewal_number: z.string(),
      date_of_renewal: z.string(),
      requested_start: z.string(),
      requested_end: z.string(),
      status: z.string(),
      old_sponsor_staff_id: z.string().uuid(),
      proposed_new_sponsor_staff_id: z.string().uuid().nullable(),
      reason_for_referrer_change: z.string().nullable(),
      endorsed_at: z.string().nullable(),
      review_notes: z.string().nullable(),
      applicant_signature_status: z.enum(['pending', 'received']),
      referrer_signature_status: z.enum(['pending', 'received']),
      /** Frozen submission-time history: never rewritten by later edits. */
      applicant_snapshot: ostApplicantSnapshotSchema,
      original_accreditation_date: z.string(),
      last_expiry_date: z.string(),
      referrer_snapshot: z.object({
        staffId: z.string().uuid(),
        name: z.string(),
        email: z.string(),
      }),
    }),
  ),
});
export const ostImportPreviewSchema = z.object({
  job: z.object({
    id: z.string().uuid(),
    source_name: z.string(),
    status: z.enum(['ready', 'completed', 'cancelled']),
    total_rows: z.number(),
    valid_rows: z.number(),
    invalid_rows: z.number(),
  }),
  rows: z.array(
    z.object({
      row_number: z.number(),
      status: z.enum(['valid', 'error', 'committed']),
      errors: z.array(z.string()),
      application_id: z.string().uuid().nullable(),
      sponsor_staff_id: z.string().uuid().nullable().optional(),
      normalized: z.record(z.string(), z.unknown()),
    }),
  ),
});
export function officialOstFormDefaults(): Record<string, string> {
  return {
    dateApplied: new Date().toISOString().slice(0, 10),
    programCategory: '',
    vipCardType: '',
    sex: '',
    civilStatus: '',
    applicantSignatureStatus: 'pending',
    referrerSignatureStatus: 'pending',
  };
}
export function parseOfficialOstFields(values: Record<string, string>) {
  const { referrerTelephone, referrerMobile, referrerAddress, referrerMessenger, ...form } = values;
  return ostOfficialFormSchema.safeParse({
    ...form,
    referrerSnapshot: {
      telephone: referrerTelephone ?? '',
      mobile: referrerMobile ?? '',
      address: referrerAddress ?? '',
      messenger: referrerMessenger ?? '',
    },
    vipCardType: values.vipCardType || null,
    applicantSignedOn: values.applicantSignedOn || null,
    referrerSignedOn: values.referrerSignedOn || null,
  });
}
