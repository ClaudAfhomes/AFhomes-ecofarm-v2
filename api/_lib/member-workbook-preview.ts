import {
  MEMBER_UPLINE_ROLE,
  memberWorkbookInput,
  ostAnnualExpiry,
  aaNumberSchema,
  normalizePersonName,
  normalizePhilippinePhone,
  memberWorkbookDisplayName,
  memberWorkbookLocalMobile,
  type Member,
  type MemberWorkbookKind,
} from '@afhomes/contracts';
import type { AddressProvider } from './address-provider.js';
import { readMemberWorkbook } from './member-workbook.js';
import { randomUUID } from 'node:crypto';
import { memberHeadLabel } from './member-company-workbook.js';

const key = (s: string) => s.trim().normalize('NFKC').toLocaleLowerCase('en');

export async function previewMemberWorkbook(
  bytes: Uint8Array,
  kind: MemberWorkbookKind,
  members: Member[],
  departmentId: string,
  provider: AddressProvider,
  conflicts: (fields: Record<string, string>) => Promise<string[]>,
) {
  const source = readMemberWorkbook(bytes, kind);
  const company = source[0]?.fields.source_layout === 'company-v2';
  const existing = new Map<number, Member>();
  if (company)
    for (const row of source) {
      const f = row.fields;
      const candidates = members.filter(
        (m) =>
          key(m.email) === key(f.email ?? '') &&
          normalizePersonName(m.fullName).toUpperCase() ===
            normalizePersonName(
              [f.first_name, f.middle_name, f.last_name].filter(Boolean).join(' '),
            ).toUpperCase() &&
          m.position === f.position &&
          (!f.aa_number || m.aaNumber === f.aa_number),
      );
      if (candidates.length === 1) existing.set(row.rowNumber, candidates[0]!);
      f.planned_staff_id = existing.get(row.rowNumber)?.id ?? randomUUID();
      f.canonical_name = normalizePersonName(
        [f.first_name, f.middle_name, f.last_name].filter(Boolean).join(' '),
      ).toUpperCase();
      f.display_name = memberWorkbookDisplayName(
        [f.first_name, f.middle_name, f.last_name].filter(Boolean).join(' '),
      );
      f.canonical_mobile = normalizePhilippinePhone(f.mobile) ?? '';
      if (/^(?:09\d{9}|\+639\d{9})$/.test(f.mobile ?? ''))
        f.mobile = memberWorkbookLocalMobile(f.mobile!);
    }
  const seen = new Map<string, number>();
  const duplicated = new Set<string>();
  for (const row of source)
    for (const field of ['email', 'mobile', 'aa_number']) {
      const value = row.fields[field];
      if (!value) continue;
      const token =
        field + ':' + key(field === 'mobile' ? (normalizePhilippinePhone(value) ?? value) : value);
      if (seen.has(token)) duplicated.add(token);
      else seen.set(token, row.rowNumber);
    }
  const provinces = await provider.provinces();
  const rows = [];
  // Cache references per geographic scope, not per member; no personal data leaves the API.
  const cities = new Map<string, ReturnType<AddressProvider['localities']>>();
  const barangays = new Map<string, ReturnType<AddressProvider['barangays']>>();
  for (const row of source) {
    const f = row.fields,
      errors: string[] = [];
    f.email = key(f.email ?? '');
    for (const field of ['email', 'mobile', 'aa_number'])
      if (
        f[field] &&
        duplicated.has(
          field +
            ':' +
            key(field === 'mobile' ? (normalizePhilippinePhone(f[field]) ?? f[field]!) : f[field]!),
        )
      )
        errors.push(`${field}: duplicated in this workbook; fix every affected row.`);
    if (!/^09\d{9}$/.test(f.mobile ?? ''))
      errors.push('mobile: use 11 digits starting 09, including the leading zero.');
    if (
      kind === 'IST' &&
      !['vice_director', 'senior_sales_manager', 'sales_manager'].includes(f.position ?? '')
    )
      errors.push('position: choose an IST position.');
    if (kind === 'OST' && f.position !== 'ost') errors.push('position: must be ost.');
    const matched = existing.get(row.rowNumber);
    const expected = matched
      ? (members.find((m) => m.id === matched.referrerStaffId)?.position ?? null)
      : MEMBER_UPLINE_ROLE[f.position as keyof typeof MEMBER_UPLINE_ROLE];
    const heads = members.filter(
      (m) =>
        (m.status === 'active' || matched?.referrerStaffId === m.id) &&
        (company
          ? [m.fullName, memberHeadLabel(m)].some(
              (label) => key(label) === key(f.head_member ?? ''),
            )
          : key(m.email) === key(f.head_member ?? '')) &&
        m.position === expected,
    );
    const batchHeads =
      company && kind === 'IST'
        ? source.filter(
            (candidate) =>
              candidate.rowNumber !== row.rowNumber &&
              candidate.fields.position === expected &&
              [
                candidate.fields.display_name ?? '',
                `${candidate.fields.display_name} [${candidate.fields.aa_number}]`,
              ].some((name) => key(name) === key(f.head_member ?? '')) &&
              !heads.some((m) => m.id === candidate.fields.planned_staff_id),
          )
        : [];
    if (expected && heads.length + batchHeads.length !== 1)
      errors.push(
        company
          ? 'head_member: choose one unambiguous name/AA label with the correct immediate-head role.'
          : 'head_member: choose the email of one existing active immediate head.',
      );
    if (!expected && f.head_member) errors.push('head_member: a Vice Director has no head.');
    f.head_staff_id =
      heads.length + batchHeads.length === 1
        ? (heads[0]?.id ?? batchHeads[0]!.fields.planned_staff_id!)
        : '';
    if (kind === 'OST' && heads.length === 1 && !matched) {
      const sm = heads[0]!;
      const ssm = members.find(
        (m) =>
          m.id === sm.referrerStaffId &&
          m.status === 'active' &&
          m.position === 'senior_sales_manager',
      );
      const vd = members.find(
        (m) =>
          m.id === ssm?.referrerStaffId && m.status === 'active' && m.position === 'vice_director',
      );
      if (!ssm || !vd) errors.push('head_member: SM must have a complete active SSM/VD team.');
    }
    const p = provinces.filter((p) => key(p.name) === key(f.province ?? ''));
    if (p.length !== 1) errors.push('province: unknown or ambiguous province.');
    else {
      const pc = p[0]!.code;
      if (!cities.has(pc)) cities.set(pc, provider.localities(pc));
      const c = (await cities.get(pc)!).filter((c) => key(c.name) === key(f.city ?? ''));
      if (c.length !== 1) errors.push('city: not a unique city under this province.');
      else {
        const city = c[0]!;
        if (!barangays.has(city.code)) barangays.set(city.code, provider.barangays(city.code));
        const b = (await barangays.get(city.code)!).filter(
          (b) => key(b.name) === key(f.barangay ?? ''),
        );
        if (b.length !== 1 && !(company && existing.has(row.rowNumber) && !f.barangay))
          errors.push('barangay: not a unique barangay under this city.');
        else if (b.length === 1) {
          f.province_code = pc;
          f.city_code = city.code;
          f.barangay_code = b[0]!.code;
          f.province = p[0]!.name;
          f.city = city.name;
          f.barangay = b[0]!.name;
        }
        if (!city.postalCode)
          errors.push('postal_code: address provider has no verified ZIP; review before import.');
        else if (f.postal_code && f.postal_code !== city.postalCode)
          errors.push('postal_code: entered ZIP disagrees with the address provider.');
        else f.postal_code = city.postalCode;
      }
    }
    if (kind === 'OST') {
      const expectedExpiry = ostAnnualExpiry(f.starts_on ?? '');
      if (f.expires_on && f.expires_on !== expectedExpiry)
        errors.push('expires_on: must be exactly one calendar year after the start date.');
      if (!matched && f.head_role && f.head_role !== 'sales_manager')
        errors.push('head_role: manual OST sponsorship requires an active Sales Manager.');
      f.expires_on = expectedExpiry;
    } else if (
      Object.keys(f).some(
        (k) =>
          [
            'starts_on',
            'date_applied',
            'program_category',
            'vip_card_type',
            'applicant_signature',
            'referrer_signature',
            'applicant_signed_on',
            'referrer_signed_on',
          ].includes(k) && f[k],
      )
    )
      errors.push(
        'Accreditation: IST employees have no accreditation term; leave these fields blank.',
      );
    if (
      company &&
      f.aa_number &&
      (!aaNumberSchema.safeParse(f.aa_number).success ||
        (kind === 'IST' && f.aa_number.startsWith('AAO')) ||
        (kind === 'OST' && f.aa_number.startsWith('AAI')))
    )
      errors.push('aa_number: invalid identifier or wrong member kind.');
    const legacyOst = company && kind === 'OST' && f.aa_number?.startsWith('AA-');
    const parsed = memberWorkbookInput(
      kind,
      legacyOst ? { ...f, aa_number: '', aa_mode: 'auto' } : f,
      departmentId,
      'Preview-only-not-a-password-1!',
    );
    if (!parsed.success && !existing.has(row.rowNumber))
      errors.push(...parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    errors.push(...(await conflicts(f)));
    if (company && existing.has(row.rowNumber)) {
      const match = existing.get(row.rowNumber)!;
      if (match.referrerStaffId !== (f.head_staff_id || null))
        errors.push(
          'head_member: current genealogy differs; import never transfers an existing member.',
        );
      if (match.mobileNo && normalizePhilippinePhone(match.mobileNo) !== f.canonical_mobile)
        errors.push('mobile: differs from existing canonical member.');
    }
    rows.push({ ...row, errors: [...new Set(errors)] });
  }
  return { kind, departmentId, rows };
}
