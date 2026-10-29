import { z } from 'zod';
import { compareMoney } from '@afhomes/shared';
import {
  validateImportRow,
  type ValidatedImportRow,
  type ImportContext,
} from './customer-import.js';
import {
  validateWorkbookFields,
  resolveWorkbookStaff,
  resolveWorkbookGeography,
  workbookApplicationPrefill,
  sameWorkbookIdentity,
  type WorkbookStaffMatch,
} from './customer-workbook.js';
import { buildImportedCustomerFacts, legacyPaymentClaims } from './customer-import-continuation.js';
import { externalImportSummary } from './external-customer-import.js';
import { addressProvider } from './address-source.js';
import {
  COMPANY_IMPORT_EXTRA_COLUMNS,
  LEGACY_MEMBERSHIP_TEMPLATE_POSITION_MAP,
  type WorkbookCustomerV2,
} from '@afhomes/contracts';
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  fetchGoogleSheetCsv,
  isCompanyMembershipTemplate,
  isInterimV2Flat,
  isLegacyCompanyMembershipTemplate,
  isV2MembershipTemplate,
  looksLikeSectionBandRow,
  matrixToRecords,
  mergeSectionedTemplateSheets,
  mergeV2SectionedTemplateSheets,
  parseCsvMatrix,
  parseXlsxSheets,
  remapCompanyTemplateMatrix,
  remapV2TemplateMatrix,
  workbookLooksInterimV2,
  workbookLooksV2,
} from './customer-import.js';
import { parseCustomerWorkbook } from './customer-workbook.js';
import { parseCustomerWorkbookV2 } from './customer-workbook-v2.js';
import { hashIdentifier } from './identifier.js';
export type CustomerImportFileInput = {
  source: 'csv' | 'excel' | 'google_sheets';
  contentBase64?: string;
  sheetUrl?: string;
};
/** Shared source-format parsing only; no database or business writes. */
export async function readCustomerImportFile(input: CustomerImportFileInput) {
  const { source } = input;
  let matrix: string[][];
  let reviewMatrix: string[][] | null = null;
  let workbookRecords: ReturnType<typeof parseCustomerWorkbook> = null;
  let workflowRecords: WorkbookCustomerV2[] | null = null;
  let workflowReview: {
    bytes: Uint8Array;
    workbook: NonNullable<ReturnType<typeof parseCustomerWorkbookV2>>;
  } | null = null;
  let sheetId: string | null = null;
  // Sectioned-template extras surface as per-row warnings below, next to
  // the established unknown-column and dropped-header warnings.
  let sectionedUnknown: string[] = [];
  // Guided-template part columns (names, the supplementary address) are
  // joined per row and overlaid onto the parsed fields after parsing.
  let v2Joins: { rowNumber: number; values: Record<string, string> }[] = [];
  let sourceHash: string | null = null;
  try {
    if (source === 'google_sheets') {
      if (!input.sheetUrl) throw new Error('A Google Sheets URL is required');
      const csv = await fetchGoogleSheetCsv(input.sheetUrl);
      sourceHash = hashIdentifier(csv);
      const { parseGoogleSheetUrl: parseUrl } = await import('@afhomes/contracts');
      sheetId = parseUrl(input.sheetUrl)?.spreadsheetId ?? null;
      matrix = parseCsvMatrix(csv);
    } else {
      if (!input.contentBase64) throw new Error('File content is required');
      const bytes = new Uint8Array(Buffer.from(input.contentBase64, 'base64'));
      sourceHash = hashIdentifier(Buffer.from(bytes).toString('base64'));
      if (bytes.length === 0 || bytes.length > MAX_IMPORT_BYTES)
        throw new Error('File is empty or exceeds the size limit');
      if (source === 'excel') {
        // The company workbook (ten source tabs, exact entry-sheet
        // headers) parses to records directly. A workbook it does not
        // claim goes through the guided/legacy sectioned merge chain: a
        // workbook whose non-guide tabs carry the guided vocabulary
        // merges as the guided template, anything else tries the legacy
        // sectioned merge. A multi-sheet file that matches neither stays
        // rejected rather than silently reading the wrong tab.
        const workflow = parseCustomerWorkbookV2(bytes, { collectErrors: true });
        if (workflow) workflowReview = { bytes, workbook: workflow };
        workflowRecords = workflow?.rows ?? null;
        workbookRecords = workflow
          ? {
              rows: workflow.rows.map((row, index) => ({
                rowNumber: workflow.sources[index]?.[0]?.row ?? index + 2,
                fields: row.fields,
              })),
              unknownHeaders: workflow.unknownHeaders,
            }
          : parseCustomerWorkbook(bytes);
        if (workbookRecords) {
          matrix = [];
        } else {
          const sheets = parseXlsxSheets(bytes);
          if (sheets.length === 1) {
            matrix = sheets[0]!.matrix;
          } else {
            // A workbook filled from the superseded interim guided layout
            // gets a pointed fix message instead of drowning in
            // unknown-column warnings from the legacy merge.
            if (workbookLooksInterimV2(sheets))
              throw new Error(
                'This workbook was filled from an older template. Download the new template and copy the rows over.',
              );
            const looksV2 = workbookLooksV2(sheets);
            try {
              if (looksV2) {
                matrix = mergeV2SectionedTemplateSheets(sheets).matrix;
              } else {
                const merged = mergeSectionedTemplateSheets(sheets);
                matrix = merged.matrix;
                sectionedUnknown = merged.unknownHeaders;
              }
            } catch (error) {
              // Surface the merge's own reason (missing tab, row-count
              // mismatch, foreign workbook): it names the exact tab and
              // fix, while the generic single-worksheet hint never did.
              throw new Error(
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : 'Import requires exactly one worksheet; for guided entry use the sectioned membership template (README + Primary/Supplementary/Related/Package)',
              );
            }
          }
        }
      } else {
        matrix = parseCsvMatrix(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        // The CSV download carries a section band row above the headers
        // so the columns read as groups; strip it here so a
        // saved-and-refilled template parses exactly like a plain header
        // file. A file without the band row (deleted, or an older
        // template) is unchanged.
        if (looksLikeSectionBandRow(matrix[0] ?? [])) matrix = matrix.slice(1);
      }
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message.slice(0, 200) : 'Unparseable file');
  }
  let records: { rowNumber: number; fields: Record<string, string> }[];
  let unknownHeaders: string[];
  // A flat file (CSV or single-sheet XLSX) filled from the superseded
  // interim guided layout gets the pointed fix message before any remap.
  if (isInterimV2Flat(matrix[0] ?? []))
    throw new Error(
      'This file was filled from an older template. Download the new template and refill it.',
    );
  // Positional remaps onto import columns: the guided layout first, then
  // the 44-column company template. Anything else keeps the established
  // name-based behavior. Dropped reference columns are reported below.
  let droppedCompanyHeaders: { index: number; header: string }[] = [];
  let droppedTemplateColumns: { index: number; header: string }[] = [];
  let templated = false;
  try {
    if (!workbookRecords) {
      if (isV2MembershipTemplate(matrix[0] ?? [])) {
        const remapped = remapV2TemplateMatrix(matrix);
        matrix = remapped.matrix;
        droppedTemplateColumns = remapped.dropped;
        v2Joins = remapped.joins;
        templated = true;
      } else if (isCompanyMembershipTemplate(matrix[0] ?? [])) {
        const remapped = remapCompanyTemplateMatrix(matrix);
        matrix = remapped.matrix;
        droppedCompanyHeaders = remapped.dropped;
        templated = true;
      } else if (isLegacyCompanyMembershipTemplate(matrix[0] ?? [])) {
        // Superseded 45-column download (OST/IST NAME still at position
        // 28): remap through the legacy positions so its values still land
        // on the existing customer-record pipeline instead of failing as
        // 45 unknown headers. Fresh downloads no longer carry the column.
        const remapped = remapCompanyTemplateMatrix(
          matrix,
          LEGACY_MEMBERSHIP_TEMPLATE_POSITION_MAP,
        );
        matrix = remapped.matrix;
        droppedCompanyHeaders = remapped.dropped;
        templated = true;
      }
    }
    if (!workbookRecords) reviewMatrix = matrix.map((row) => [...row]);
    const converted =
      workbookRecords ??
      // Remapped template keys live outside the established template
      // columns; every other file keeps strict known headers.
      matrixToRecords(matrix, templated ? [...COMPANY_IMPORT_EXTRA_COLUMNS] : []);
    records = converted.rows;
    unknownHeaders = converted.unknownHeaders.filter((h) => !h.startsWith('__company_ignored_'));
    // Part columns land on their join key (never derived from FULL
    // NAME); blank parts leave the field alone. Keyed by row number so
    // dropped all-blank rows cannot shift the alignment.
    if (v2Joins.length > 0) {
      const byRow = new Map(v2Joins.map((join) => [join.rowNumber, join.values]));
      for (const record of converted.rows) {
        const values = byRow.get(record.rowNumber);
        if (!values) continue;
        for (const [key, value] of Object.entries(values))
          if (value.trim() !== '') record.fields[key] = value;
      }
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Empty spreadsheet');
  }
  if (records.length > MAX_IMPORT_ROWS)
    throw new Error(`Import exceeds the ${MAX_IMPORT_ROWS}-row limit`);
  // Export-shape alias: a re-imported export carries derived_category
  // instead of source_status. Unknown columns otherwise only warn.
  for (const record of records) {
    if (!workbookRecords) delete record.fields.workbook_format;
    if (!record.fields.source_status && record.fields.derived_category)
      record.fields.source_status = record.fields.derived_category;
  }

  return {
    sourceHash,
    sheetId,
    workbookRecords,
    workflowRecords,
    workflowReview,
    reviewMatrix,
    records,
    unknownHeaders,
    sectionedUnknown,
    droppedCompanyHeaders,
    droppedTemplateColumns,
  };
}

/** Existing row rules shared by both database runtimes. Source claims remain unverified. */
export async function validateCustomerImportFile(
  file: Awaited<ReturnType<typeof readCustomerImportFile>>,
  ctx: ImportContext,
  staffMatches: WorkbookStaffMatch[],
  raOwners: Map<string, Set<string>>,
  externalVerificationReason?: string,
) {
  const {
    records,
    workbookRecords,
    workflowRecords,
    workflowReview,
    unknownHeaders,
    sectionedUnknown,
    droppedCompanyHeaders,
    droppedTemplateColumns,
  } = file;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  if (externalVerificationReason && !workflowRecords)
    throw new Error(
      'Externally verified imports require the guided customer workbook with contract dates and individual payment history.',
    );
  const seen = new Map<string, number>();
  const validated: ValidatedImportRow[] = [];
  for (const [recordIndex, r] of records.entries()) {
    const v = validateImportRow(
      r.rowNumber,
      workbookRecords && r.fields.suffix === 'N/A' ? { ...r.fields, suffix: '' } : r.fields,
      ctx,
      today,
    );
    if (workflowReview) {
      const sources = workflowReview.workbook.sources[recordIndex] ?? [];
      const allSources = workflowReview.workbook.sources.flat();
      for (const issue of workflowReview.workbook.issues) {
        const belongs = sources.some((s) => s.sheet === issue.sheet && s.row === issue.row);
        const orphan = !allSources.some((s) => s.sheet === issue.sheet && s.row === issue.row);
        if (belongs || orphan)
          v.errors.push({
            field: issue.field,
            message: issue.sheet + ' row ' + issue.row + ': ' + issue.message,
          });
      }
    }
    if (workbookRecords) {
      validateWorkbookFields(r.fields, v);
      resolveWorkbookStaff(r.fields, staffMatches, v);
      await resolveWorkbookGeography(r.fields, addressProvider(), v);
      try {
        workbookApplicationPrefill(r.fields);
      } catch (error) {
        if (!(error instanceof z.ZodError)) throw error;
        for (const issue of error.issues) {
          const [holder, property] = issue.path;
          const workbookKey =
            property === 'citizenship' ? 'citizenship' : property === 'tinNumber' ? 'tin' : null;
          const field =
            workbookKey && ['primary', 'secondary'].includes(String(holder))
              ? (holder === 'secondary' ? 'secondary_' : '') + workbookKey
              : issue.path.join('.');
          if (!v.errors.some((error) => error.field === field))
            v.errors.push({ field, message: issue.message });
        }
      }
      const owners = raOwners.get(r.fields.ra_number ?? '');
      if (owners && [...owners].some((email) => email !== r.fields.email?.toLowerCase()))
        v.errors.push({
          field: 'ra_number',
          message:
            'Reservation agreement reference belongs to an existing record; manual identity review required',
        });
      for (const field of r.fields.workbook_format === 'company_v2'
        ? ['customer_key', 'purchase_reference']
        : ['email', 'ra_number', 'customer_number']) {
        const value = r.fields[field]?.trim().toLowerCase();
        if (!value) continue;
        const key = field + ':' + value;
        const previous = seen.get(key);
        if (previous !== undefined) {
          v.errors.push({ field, message: `Duplicate identity in Excel row ${previous}` });
          const first = validated.find((row) => row.rowNumber === previous)!;
          first.errors.push({
            field,
            message: `Duplicate identity in Excel row ${r.rowNumber}`,
          });
          first.validation = 'error';
          first.action = 'CONFLICT';
          first.normalized = null;
        } else seen.set(key, r.rowNumber);
      }
      // A matched identity is reviewed separately; bulk imports never overwrite it.
      if (v.customerId && r.fields.workbook_format !== 'company_v2') {
        const previous = ctx.companySnapshots?.get(v.customerId);
        const unchanged =
          previous &&
          ['first_name', 'last_name', 'middle_name', 'birth_date'].every(
            (key) => (previous.current[key] ?? '') === (r.fields[key] ?? ''),
          ) &&
          previous.current.phone === r.fields.mobile;
        if (unchanged && sameWorkbookIdentity(r.fields, previous.fields)) v.action = 'SKIP';
        else
          v.errors.push({
            field: 'email',
            message:
              'Existing customer: review identity and supplementary information before changing protected records',
          });
      }
      v.fields = { ...v.fields, ...r.fields };
      if (v.normalized && !v.errors.length) {
        v.normalized.customerFacts = buildImportedCustomerFacts(r.fields);
        v.normalized.paymentClaims =
          workflowRecords?.find((w) => w.customerKey === r.fields.customer_key)?.payments ??
          legacyPaymentClaims(r.fields);
        if (externalVerificationReason) {
          try {
            if (!r.fields.referrer_staff_id)
              throw new Error('Select a registered Referrer before importing verified history.');
            if (r.fields.contract_date! > today)
              throw new Error('Contract date cannot be in the future.');
            if (compareMoney(r.fields.stated_rf || '0.00', '10000.00') !== 0)
              throw new Error('The included reservation fee must be 10000.00.');
            v.normalized.externalSummary = externalImportSummary(
              r.fields,
              v.normalized.paymentClaims,
            );
            v.normalized.externalVerified = true;
            v.normalized.externalReason = externalVerificationReason;
          } catch (error) {
            v.errors.push({
              field: 'external_history',
              message:
                error instanceof Error ? error.message : 'Invalid externally verified history.',
            });
          }
        }
      }
      if (v.errors.length) {
        v.validation = 'error';
        v.action = 'CONFLICT';
        v.normalized = null;
      }
    }
    for (const h of unknownHeaders)
      v.warnings.push({ field: h, message: 'Unknown column: ignored' });
    for (const h of sectionedUnknown)
      v.warnings.push({ field: h, message: 'Unknown column: ignored' });
    for (const dropped of droppedCompanyHeaders)
      v.warnings.push({
        field: dropped.header || `column ${dropped.index + 1}`,
        message: 'Company template column has no v2 import target and was ignored',
      });
    for (const dropped of droppedTemplateColumns)
      v.warnings.push({
        field: dropped.header || `column ${dropped.index + 1}`,
        message: 'Reference-only column was ignored',
      });
    if (v.errors.length === 0 && v.warnings.length > 0) v.validation = 'warning';
    validated.push(v);
  }

  return validated;
}
