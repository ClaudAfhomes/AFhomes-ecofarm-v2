import {
  memberWorkbookKindSchema,
  memberWorkbookUploadSchema,
  normalizePhilippinePhone,
  type Member,
} from '@afhomes/contracts';
import { memberWorkbook, readMemberWorkbook } from './member-workbook.js';
import { previewMemberWorkbook } from './member-workbook-preview.js';
import { addressProvider } from './address-source.js';
import { authorizeAfHomes, type AfHomesPrincipal } from './afhomes-access.js';
import { deny, fail, jsonBody, method, subPath } from './handler-kit.js';
import { toXlsxMulti } from './report-export.js';
import type { serviceClient } from './rest.js';
import type { VercelRequest, VercelResponse } from './http.js';

export async function handleMemberWorkbook(
  req: VercelRequest,
  res: VercelResponse,
  db: NonNullable<ReturnType<typeof serviceClient>>,
  getMembers: () => Promise<Member[]>,
  allowedPositions: (actor: AfHomesPrincipal) => Promise<Set<string>>,
) {
  const path = subPath(req);
  const preview = path === 'workbook/preview' && method(req) === 'POST';
  if (
    !preview &&
    !(method(req) === 'GET' && ['workbook/template', 'workbook/export'].includes(path))
  )
    return fail(res, 'NOT_FOUND', 'Workbook endpoint not found.', 404);
  const auth = await authorizeAfHomes(
    req,
    'network.members',
    path === 'workbook/export' ? 'view' : 'create',
  );
  if ('error' in auth) return deny(res, auth);
  const body = preview ? memberWorkbookUploadSchema.safeParse(jsonBody(req)) : null;
  const kind = memberWorkbookKindSchema.safeParse(
    preview && body?.success ? body.data.kind : req.query.kind,
  );
  if (!kind.success || (preview && !body?.success))
    return fail(
      res,
      'VALIDATION_ERROR',
      'Choose IST/OST and upload the current XLSX template.',
      400,
    );
  if (
    kind.data === 'OST' &&
    path !== 'workbook/export' &&
    !['admin', 'super_admin'].includes(auth.roleSlug)
  )
    return fail(
      res,
      'FORBIDDEN',
      'Administrator approval is required for completed OST accounts.',
      403,
    );
  res.setHeader('Cache-Control', 'no-store');
  let members: Member[];
  try {
    members = await getMembers();
  } catch {
    return fail(
      res,
      'CONFLICT',
      'Unable to verify the complete member/team roster. No import/export was performed.',
      409,
    );
  }
  const send = (filename: string, bytes: Uint8Array) =>
    res.status(200).json({
      filename,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: Buffer.from(bytes).toString('base64'),
    });
  if (path === 'workbook/template')
    return send(
      `afhomes-${kind.data.toLowerCase()}-template.xlsx`,
      memberWorkbook(kind.data, members),
    );
  if (path === 'workbook/export') {
    const rows = members.filter((m) =>
      kind.data === 'OST' ? m.position === 'ost' : m.position !== 'ost',
    );
    const ostPhones = new Map<string, string>();
    if (kind.data === 'OST' && rows.length) {
      const result = await db
        .from('ost_members')
        .select('id,phone', { count: 'exact' })
        .in(
          'id',
          rows.map((r) => r.id),
        );
      if (result.error || result.count !== (result.data?.length ?? 0))
        return fail(res, 'CONFLICT', 'Unable to verify OST contact data.', 409);
      for (const r of result.data ?? []) ostPhones.set(String(r.id), String(r.phone ?? ''));
    }
    return send(
      `afhomes-${kind.data.toLowerCase()}-roster.xlsx`,
      toXlsxMulti(`${kind.data} roster`, [
        {
          name: 'README',
          columns: [{ label: 'Read-only roster', type: 'text' }],
          rows: [
            ['Not an import template. No passwords, TIN or government ID numbers.'],
            ['Team is current genealogy, not historical sale attribution.'],
          ],
          filter: false,
        },
        {
          name: kind.data,
          columns: [
            'Member ID',
            'Employee number',
            'Name',
            'Email',
            'Mobile',
            'Position',
            'Status',
            'AA number',
            'Immediate head',
            'Head email',
          ].map((label) => ({ label, type: 'text' })),
          rows: rows.map((m) => [
            m.id,
            m.employeeNumber,
            m.fullName,
            m.email,
            kind.data === 'OST' ? (ostPhones.get(m.id) ?? '') : m.mobileNo,
            m.position,
            m.status,
            m.aaNumber,
            m.referrerName,
            members.find((h) => h.id === m.referrerStaffId)?.email ?? '',
          ]),
        },
      ]),
    );
  }
  if (!body?.success) return;
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      body.data.contentBase64,
    )
  )
    return fail(res, 'VALIDATION_ERROR', 'Upload a valid XLSX file.', 400);
  const bytes = Buffer.from(body.data.contentBase64, 'base64');
  if (bytes.length > 8_000_000)
    return fail(res, 'VALIDATION_ERROR', 'Maximum file size is 8 MB.', 400);
  const department = await db
    .from('departments')
    .select('id')
    .eq('code', 'SALES')
    .eq('is_active', true)
    .maybeSingle();
  if (department.error || !department.data)
    return fail(res, 'CONFLICT', 'An active Sales department is required.', 409);
  try {
    const allowed = await allowedPositions(auth);
    const uploaded = readMemberWorkbook(bytes);
    const existingEmails = new Set<string>(),
      existingMobiles = new Set<string>();
    const pendingEmails = new Set<string>(),
      pendingMobiles = new Set<string>();
    // Bound reference reads by unique fields; never issue four queries per member.
    for (let offset = 0; offset < uploaded.length; offset += 100) {
      const batch = uploaded.slice(offset, offset + 100);
      const emails = [
        ...new Set(batch.map((r) => (r.fields.email ?? '').trim().toLowerCase()).filter(Boolean)),
      ];
      const phones = [
        ...new Set(
          batch.flatMap((r) => {
            const raw = r.fields.mobile ?? '';
            return [raw, normalizePhilippinePhone(raw) ?? ''].filter(Boolean);
          }),
        ),
      ];
      const results = await Promise.all([
        db.from('staff_users').select('email', { count: 'exact' }).in('email', emails),
        db
          .from('network_member_profiles')
          .select('mobile_no', { count: 'exact' })
          .in('mobile_no', phones),
        db.from('ost_members').select('phone', { count: 'exact' }).in('phone', phones),
        db
          .from('ost_applications')
          .select('email,phone', { count: 'exact' })
          .in('email', emails)
          .in('status', ['submitted', 'under_review', 'changes_requested', 'approved']),
        db
          .from('ost_applications')
          .select('email,phone', { count: 'exact' })
          .in('phone', phones)
          .in('status', ['submitted', 'under_review', 'changes_requested', 'approved']),
      ]);
      if (results.some((r) => r.error || r.count !== (r.data?.length ?? 0)))
        throw new Error('Conflict checks unavailable.');
      for (const r of results[0]!.data ?? []) existingEmails.add(String(r.email).toLowerCase());
      for (const r of results[1]!.data ?? [])
        existingMobiles.add(normalizePhilippinePhone(r.mobile_no) ?? String(r.mobile_no));
      for (const r of results[2]!.data ?? [])
        existingMobiles.add(normalizePhilippinePhone(r.phone) ?? String(r.phone));
      for (const r of [...(results[3]!.data ?? []), ...(results[4]!.data ?? [])]) {
        pendingEmails.add(String(r.email).toLowerCase());
        pendingMobiles.add(normalizePhilippinePhone(r.phone) ?? String(r.phone));
      }
    }
    const result = await previewMemberWorkbook(
      bytes,
      kind.data,
      members,
      String(department.data.id),
      addressProvider(),
      async (f) => {
        const errors: string[] = [];
        if (kind.data === 'IST' && !allowed.has(f.position ?? ''))
          errors.push(
            'position: you cannot assign this role; an authorized administrator must create it.',
          );
        if (existingEmails.has(f.email ?? ''))
          errors.push('email: an existing staff account already uses this email.');
        if (existingMobiles.has(normalizePhilippinePhone(f.mobile) ?? f.mobile ?? ''))
          errors.push('mobile: an existing member already uses this mobile.');
        if (
          pendingEmails.has(f.email ?? '') ||
          pendingMobiles.has(normalizePhilippinePhone(f.mobile) ?? f.mobile ?? '')
        )
          errors.push(
            'email/mobile: an OST application already exists; use its existing approval flow.',
          );
        if (f.aa_number) {
          const aa = await db.rpc('search_sale_team_accreditation', {
            p_aa_number: f.aa_number.toUpperCase(),
          });
          if (aa.error) throw new Error('AA verification unavailable; retry preview.');
          if (Array.isArray(aa.data) ? aa.data.length > 0 : aa.data != null)
            errors.push('aa_number: already issued.');
        }
        return errors;
      },
    );
    return res.status(200).json(result);
  } catch {
    return fail(
      res,
      'VALIDATION_ERROR',
      'Unable to validate this workbook. Check current template headers, literal input cells, row limit and address availability. No accounts were created.',
      400,
    );
  }
}
