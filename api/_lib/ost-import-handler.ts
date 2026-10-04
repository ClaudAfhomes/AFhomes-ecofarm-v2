import { z } from 'zod';
import { parseGoogleSheetUrl } from '@jad/contracts';
import {
  OST_IMPORT_COLUMNS,
  ostImportSourceSchema,
  readOstImport,
  parseOstImportRow,
} from './ost-import.js';
import { toCsv, toXlsx } from './report-export.js';
import { officialFormPdf } from './official-forms.js';
import { fail, jsonBody, method, subPath } from './handler-kit.js';
import type { AfHomesPrincipal } from './afhomes-access.js';
import type { serviceClient } from './rest.js';
import type { VercelRequest, VercelResponse } from './http.js';

export async function handleOstImport(
  req: VercelRequest,
  res: VercelResponse,
  db: NonNullable<ReturnType<typeof serviceClient>>,
  actor: AfHomesPrincipal,
) {
  const path = subPath(req);
  if (actor.roleSlug === 'ost')
    return fail(res, 'FORBIDDEN', 'Imports and exports are available to authorized staff.', 403);
  const failed = () =>
    fail(
      res,
      'CONFLICT',
      'Unable to process the import. Review the sponsor, duplicates and current job status.',
      409,
    );
  if (path === 'official-template' && method(req) === 'GET') {
    const fields = Object.fromEntries(
      [
        ...OST_IMPORT_COLUMNS,
        'af_number',
        'referrer_name',
        'referrer_email',
        'referrer_mobile',
        'referrer_address',
        'sales_manager_endorsement',
        'management_approval',
        'approved_start',
        'approved_expiry',
      ].map((name) => [name, '________________________']),
    );
    const bytes = officialFormPdf('AF HOMES SELLER ACCREDITATION / REGISTRATION FORM', fields);
    return res.status(200).json({
      filename: 'afhomes-ost-accreditation-template.pdf',
      mime: 'application/pdf',
      content: Buffer.from(bytes).toString('base64'),
    });
  }
  if ((path === 'template' || path === 'export') && method(req) === 'GET') {
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    let headers: string[] = [...OST_IMPORT_COLUMNS];
    let rows: unknown[][] = [];
    if (path === 'export') {
      headers = ['OST number', 'Name', 'Email', 'Mobile', 'Status'];
      let query = db
        .from('ost_members')
        .select('ost_number,full_name,email,phone,status')
        .order('ost_number')
        .limit(5001);
      if (['vice_director', 'senior_sales_manager', 'sales_manager'].includes(actor.roleSlug))
        query = query.eq('sponsor_staff_id', actor.userId);
      const result = await query;
      if (result.error) return failed();
      if (result.data.length > 5000)
        return fail(res, 'VALIDATION_ERROR', 'Narrow the export below 5,000 records.', 400);
      rows = result.data.map((r) => [r.ost_number, r.full_name, r.email, r.phone, r.status]);
    }
    const bytes =
      format === 'csv'
        ? Buffer.from(toCsv(headers, rows))
        : toXlsx(
            'OST',
            headers.map((label) => ({ label, type: 'text' })),
            rows,
          );
    return res.status(200).json({
      filename: `afhomes-ost-${path}.${format}`,
      mime:
        format === 'csv'
          ? 'text/csv;charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: Buffer.from(bytes).toString('base64'),
    });
  }
  if (path === 'imports/parse' && method(req) === 'POST') {
    const parsed = ostImportSourceSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(res, 'VALIDATION_ERROR', 'Choose a supported OST import source.', 400);
    let sourceRows: Awaited<ReturnType<typeof readOstImport>>;
    try {
      sourceRows = await readOstImport(parsed.data);
    } catch (error) {
      return fail(
        res,
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Unable to read the import.',
        400,
      );
    }
    const rows = [];
    const seen = new Set<string>();
    const parsedRows = sourceRows.map((row) => ({ row, checked: parseOstImportRow(row.fields) }));
    const inputs = parsedRows.flatMap((r) => (r.checked.success ? [r.checked.data] : []));
    const activeSponsors = new Set<string>();
    const duplicateEmails = new Set<string>();
    const duplicatePhones = new Set<string>();
    // Bound each PostgREST query and batch safe identifiers.
    for (let offset = 0; offset < inputs.length; offset += 100) {
      const batch = inputs.slice(offset, offset + 100);
      const emails = [...new Set(batch.map((i) => i.identity.email))];
      const phones = [...new Set(batch.map((i) => i.identity.phone))];
      const results = await Promise.all([
        db
          .from('staff_users')
          .select('id,status,staff_role_assignments(roles(slug,is_active))')
          .in('id', [...new Set(batch.map((i) => i.sponsorStaffId))]),
        db
          .from('ost_applications')
          .select('email,phone')
          .in('email', emails)
          .in('status', ['submitted', 'under_review', 'changes_requested', 'approved']),
        db
          .from('ost_applications')
          .select('email,phone')
          .in('phone', phones)
          .in('status', ['submitted', 'under_review', 'changes_requested', 'approved']),
        db.from('staff_users').select('email').in('email', emails),
      ]);
      if (results.some((r) => r.error)) return failed();
      for (const sponsor of results[0].data ?? []) {
        const checked = z
          .object({
            id: z.string(),
            status: z.string(),
            staff_role_assignments: z.array(
              z.object({ roles: z.object({ slug: z.string(), is_active: z.boolean() }) }),
            ),
          })
          .safeParse(sponsor);
        if (
          checked.success &&
          checked.data.status === 'active' &&
          checked.data.staff_role_assignments.some(
            (a) => a.roles.slug === 'sales_manager' && a.roles.is_active,
          )
        )
          activeSponsors.add(checked.data.id);
      }
      for (const application of [...(results[1].data ?? []), ...(results[2].data ?? [])]) {
        duplicateEmails.add(application.email);
        duplicatePhones.add(application.phone);
      }
      for (const staff of results[3].data ?? []) duplicateEmails.add(staff.email);
    }
    for (const { row, checked } of parsedRows) {
      const errors: string[] = [];
      if (!checked.success)
        errors.push(...checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      if (checked.success) {
        const input = checked.data;
        if (seen.has(input.identity.email) || seen.has(input.identity.phone))
          errors.push('Duplicate email or mobile within this import.');
        seen.add(input.identity.email);
        seen.add(input.identity.phone);
        if (!activeSponsors.has(input.sponsorStaffId))
          errors.push('Sponsor must be an active Sales Manager.');
        if (duplicateEmails.has(input.identity.email) || duplicatePhones.has(input.identity.phone))
          errors.push(
            'An OST application/account already uses this email or mobile. Review the existing record.',
          );
      }
      rows.push({
        rowNumber: row.rowNumber,
        sponsorStaffId: checked.success ? checked.data.sponsorStaffId : null,
        normalized: checked.success
          ? { identity: checked.data.identity, form: checked.data.form }
          : {},
        status: errors.length ? 'error' : 'valid',
        errors,
      });
    }
    const result = await db.rpc('stage_ost_import', {
      p_actor_id: actor.userId,
      p_source: parsed.data.source,
      p_name: parsed.data.sourceName,
      p_sheet_id:
        parsed.data.source === 'google_sheets'
          ? (parseGoogleSheetUrl(parsed.data.sheetUrl ?? '')?.spreadsheetId ?? null)
          : null,
      p_rows: rows,
    });
    if (result.error) return failed();
    const preview = await db.rpc('ost_import_preview', {
      p_actor_id: actor.userId,
      p_id: result.data,
    });
    if (preview.error) return failed();
    return res.status(201).json(preview.data);
  }
  const match = path.match(/^imports\/([^/]+)(?:\/(confirm))?$/);
  if (match && z.string().uuid().safeParse(match[1]).success) {
    const confirm = match[2] === 'confirm' && method(req) === 'POST';
    if (!confirm && (method(req) !== 'GET' || match[2]))
      return fail(res, 'NOT_FOUND', 'Import endpoint not found.', 404);
    const result = await db.rpc(confirm ? 'confirm_ost_import' : 'ost_import_preview', {
      p_actor_id: actor.userId,
      p_id: match[1],
    });
    if (result.error) return failed();
    return res.status(200).json(result.data);
  }
  return fail(res, 'NOT_FOUND', 'Import endpoint not found.', 404);
}
