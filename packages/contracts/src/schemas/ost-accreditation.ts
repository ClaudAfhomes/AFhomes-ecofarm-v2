import { z } from 'zod';
import { submitOstApplicationSchema } from './ost.js';

const date = z.iso.date();
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
    governmentIdType: z.string().trim().min(1).max(100),
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

export const ostIdentitySchema = submitOstApplicationSchema.omit({ referralCode: true }).strict();
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
  .object({ startsOn: date, expiresOn: date })
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

export type OstOfficialForm = z.infer<typeof ostOfficialFormSchema>;
export type OstIdentity = z.infer<typeof ostIdentitySchema>;
export type SubmitOstAccreditation = z.infer<typeof submitOstAccreditationSchema>;
export type ManualOstAccreditation = z.infer<typeof manualOstAccreditationSchema>;
export type SubmitOstRenewal = z.infer<typeof submitOstRenewalSchema>;

export const ostMutationResultSchema = z.object({ id: z.string().uuid() });
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
