import { z } from 'zod';
import { manualOstAccreditationSchema } from '@afhomes/contracts';
import { randomUUID } from 'node:crypto';
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseCsvMatrix,
  parseXlsxMatrix,
  fetchGoogleSheetCsv,
} from './customer-import.js';

export const OST_IMPORT_COLUMNS = [
  'first_name',
  'middle_name',
  'last_name',
  'email',
  'mobile',
  'birth_date',
  'address',
  'city',
  'province',
  'postal_code',
  'sponsor_staff_id',
  'date_applied',
  'program_category',
  'vip_card_type',
  'sex',
  'civil_status',
  'telephone',
  'messenger',
  'tin',
  'employer_name',
  'employer_address',
  'job_position',
  'government_id_type',
  'government_id_number',
  'applicant_signature_status',
  'applicant_signed_on',
  'referrer_signature_status',
  'referrer_signed_on',
  'referrer_telephone',
  'referrer_mobile',
  'referrer_address',
  'referrer_messenger',
] as const;
export const ostImportSourceSchema = z
  .object({
    source: z.enum(['excel', 'csv', 'google_sheets']),
    sourceName: z.string().trim().min(1).max(200),
    mime: z
      .enum(['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
      .optional(),
    contentBase64: z
      .string()
      .max(MAX_IMPORT_BYTES * 2)
      .optional(),
    sheetUrl: z.string().max(500).optional(),
  })
  .strict();
export async function readOstImport(input: z.infer<typeof ostImportSourceSchema>) {
  let matrix: string[][];
  if (input.source === 'google_sheets') {
    if (!input.sheetUrl) throw new Error('Provide a public Viewer Google Sheet URL.');
    matrix = parseCsvMatrix(await fetchGoogleSheetCsv(input.sheetUrl));
  } else {
    if (
      !input.contentBase64 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.contentBase64)
    )
      throw new Error('Upload a valid base64 file.');
    const bytes = Buffer.from(input.contentBase64, 'base64');
    if (!bytes.length || bytes.length > MAX_IMPORT_BYTES)
      throw new Error('The import exceeds the file size limit.');
    if (input.source === 'excel') {
      if (
        input.mime !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        bytes[0] !== 0x50 ||
        bytes[1] !== 0x4b
      )
        throw new Error('Upload an XLSX spreadsheet.');
      matrix = parseXlsxMatrix(bytes);
    } else {
      if (input.mime !== 'text/csv' || bytes.includes(0))
        throw new Error('Upload a plain CSV file.');
      matrix = parseCsvMatrix(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
  }
  const headers = (matrix[0] ?? []).map((x) =>
    x
      .trim()
      .replace(/^\uFEFF/, '')
      .toLowerCase(),
  );
  if (
    !headers.length ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !OST_IMPORT_COLUMNS.some((c) => c === h))
  )
    throw new Error('Use the OST import template headers.');
  const rows = matrix
    .slice(1)
    .map((cells, index) => ({
      rowNumber: index + 2,
      fields: Object.fromEntries(headers.map((h, i) => [h, cells[i]?.trim() ?? ''])),
    }))
    .filter((r) => Object.values(r.fields).some(Boolean));
  if (!rows.length || rows.length > MAX_IMPORT_ROWS)
    throw new Error('The import must contain 1–5,000 rows.');
  return rows;
}
export function parseOstImportRow(f: Record<string, string>) {
  return manualOstAccreditationSchema.safeParse({
    requestId: randomUUID(),
    sponsorStaffId: f.sponsor_staff_id,
    identity: {
      firstName: f.first_name,
      middleName: f.middle_name || undefined,
      lastName: f.last_name,
      email: f.email,
      phone: f.mobile,
      birthDate: f.birth_date,
      address: {
        line1: f.address,
        city: f.city,
        province: f.province,
        postalCode: f.postal_code || undefined,
        countryCode: 'PH',
      },
    },
    form: {
      dateApplied: f.date_applied,
      programCategory: f.program_category,
      vipCardType: f.vip_card_type || null,
      sex: f.sex,
      civilStatus: f.civil_status,
      telephone: f.telephone || '',
      messenger: f.messenger || '',
      tin: f.tin || '',
      employerName: f.employer_name || '',
      employerAddress: f.employer_address || '',
      jobPosition: f.job_position || '',
      governmentIdType: f.government_id_type,
      governmentIdNumber: f.government_id_number,
      applicantSignatureStatus: f.applicant_signature_status || 'pending',
      referrerSignatureStatus: f.referrer_signature_status || 'pending',
      applicantSignedOn: f.applicant_signed_on || null,
      referrerSignedOn: f.referrer_signed_on || null,
      referrerSnapshot: {
        telephone: f.referrer_telephone || '',
        mobile: f.referrer_mobile || '',
        address: f.referrer_address || '',
        messenger: f.referrer_messenger || '',
      },
    },
  });
}
