import { z } from 'zod';
import { createMemberSchema, createOstMemberSchema } from './member.js';
import { ostAnnualExpiry } from './ost-accreditation.js';
import { normalizePhilippinePhone, toTitleCase } from './input.js';

/** Presentation only; mixed-case spelling is retained rather than reconstructed. */
export const memberWorkbookDisplayName = (name: string) =>
  name === name.toUpperCase() || name === name.toLowerCase() ? toTitleCase(name) : name.trim();
export const memberWorkbookLocalMobile = (phone: string) => {
  const canonical = normalizePhilippinePhone(phone);
  return canonical && /^\+639\d{9}$/.test(canonical) ? '0' + canonical.slice(3) : phone;
};

export const memberWorkbookKindSchema = z.enum(['IST', 'OST']);
export type MemberWorkbookKind = z.infer<typeof memberWorkbookKindSchema>;
export const MEMBER_WORKBOOK_ROWS = 500;
export const memberWorkbookUploadSchema = z
  .object({
    kind: memberWorkbookKindSchema,
    contentBase64: z.string().min(4).max(10_666_668),
  })
  .strict();
export const memberWorkbookPreviewSchema = z.object({
  jobId: z.string().uuid().optional(),
  kind: memberWorkbookKindSchema,
  departmentId: z.string().uuid(),
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int().min(2),
        fields: z.record(z.string(), z.string()),
        errors: z.array(z.string()),
      }),
    )
    .max(MEMBER_WORKBOOK_ROWS),
});
export const memberWorkbookJobRowSchema = z.object({
  id: z.string().uuid(),
  rowNumber: z.number().int(),
  decision: z.enum(['CREATE', 'MATCH', 'SKIP', 'CONFLICT', 'REVIEW']),
  state: z.enum(['preview', 'creating', 'completed']),
  errors: z.array(z.string()),
  memberId: z.string().uuid().nullable(),
  name: z.string(),
  email: z.string(),
  mobile: z.string(),
  aaNumber: z.string().nullable(),
  head: z.string().nullable(),
  position: z.string(),
  details: z.record(z.string(), z.string()).default({}),
  lastError: z.enum(['REVIEW_REQUIRED', 'OUTCOME_UNCONFIRMED']).nullable().default(null),
  attempts: z.number().int().default(0),
});
export const memberWorkbookJobSchema = z.object({
  id: z.string().uuid(),
  kind: memberWorkbookKindSchema,
  sourceHash: z.string(),
  createdAt: z.string(),
  rows: z.array(memberWorkbookJobRowSchema),
});
export const memberWorkbookJobsSchema = z.array(memberWorkbookJobSchema);
export type MemberWorkbookJob = z.infer<typeof memberWorkbookJobSchema>;
export type MemberWorkbookPreview = z.infer<typeof memberWorkbookPreviewSchema>;
export const memberWorkbookFileSchema = z.object({
  filename: z.string(),
  mime: z.string(),
  content: z.string(),
});

/** Shared by preview and confirmation; password is supplied only at confirmation. */
export function memberWorkbookInput(
  kind: MemberWorkbookKind,
  f: Record<string, string>,
  departmentId: string,
  temporaryPassword: string,
) {
  const aa = { aaNumberMode: f.aa_mode || 'auto', aaNumber: f.aa_number || undefined };
  if (kind === 'IST')
    return createMemberSchema.safeParse({
      ...aa,
      temporaryPassword,
      departmentId,
      position: f.position,
      fullName: [f.first_name, f.middle_name, f.last_name].filter(Boolean).join(' '),
      email: f.email,
      dateOfBirth: f.birth_date,
      sex: f.sex,
      civilStatus: f.civil_status,
      streetNo: [f.address_line_1, f.barangay].filter(Boolean).join(', '),
      province: f.province,
      cityMunicipality: f.city,
      zipCode: f.postal_code,
      provinceCode: f.province_code,
      cityMunicipalityCode: f.city_code,
      mobileNo: f.mobile,
      telNo: f.telephone || undefined,
      fbMessenger: f.messenger || undefined,
      tin: f.tin || undefined,
      employerName: f.employer_name,
      employerAddress: f.employer_address,
      jobPosition: f.job_position,
      governmentIdType: f.government_id_type,
      governmentIdNumber: f.government_id_number,
      referrerStaffId: f.head_staff_id || null,
    });
  return createOstMemberSchema.safeParse({
    ...aa,
    mode: 'complete',
    temporaryPassword,
    requestId: f.request_id,
    sponsorStaffId: f.head_staff_id,
    startsOn: f.starts_on,
    expiresOn: ostAnnualExpiry(f.starts_on ?? ''),
    identity: {
      firstName: f.first_name,
      middleName: f.middle_name || undefined,
      lastName: f.last_name,
      email: f.email,
      phone: f.mobile,
      birthDate: f.birth_date,
      address: {
        line1: f.address_line_1,
        province: f.province,
        city: f.city,
        barangay: f.barangay,
        postalCode: f.postal_code,
        countryCode: 'PH',
      },
      addressHierarchy: {
        provinceCode: f.province_code,
        localityCode: f.city_code,
        barangayCode: f.barangay_code,
      },
    },
    form: {
      dateApplied: f.date_applied,
      programCategory: f.program_category,
      vipCardType: f.vip_card_type || null,
      sex: f.sex?.toLowerCase(),
      civilStatus: f.civil_status?.toLowerCase(),
      telephone: f.telephone || '',
      messenger: f.messenger || '',
      tin: f.tin || '',
      employerName: f.employer_name || '',
      employerAddress: f.employer_address || '',
      jobPosition: f.job_position || '',
      governmentIdType: f.government_id_type,
      governmentIdNumber: f.government_id_number,
      applicantSignatureStatus: f.applicant_signature,
      referrerSignatureStatus: f.referrer_signature,
      applicantSignedOn: f.applicant_signed_on || null,
      referrerSignedOn: f.referrer_signed_on || null,
    },
  });
}
