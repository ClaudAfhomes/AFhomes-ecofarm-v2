import {
  MEMBER_UPLINE_ROLE,
  memberWorkbookInput,
  ostAnnualExpiry,
  type Member,
  type MemberWorkbookKind,
} from '@afhomes/contracts';
import type { AddressProvider } from './address-provider.js';
import { readMemberWorkbook } from './member-workbook.js';

const key = (s: string) => s.trim().normalize('NFKC').toLocaleLowerCase('en');

export async function previewMemberWorkbook(
  bytes: Uint8Array,
  kind: MemberWorkbookKind,
  members: Member[],
  departmentId: string,
  provider: AddressProvider,
  conflicts: (fields: Record<string, string>) => Promise<string[]>,
) {
  const source = readMemberWorkbook(bytes);
  const seen = new Map<string, number>();
  const duplicated = new Set<string>();
  for (const row of source)
    for (const field of ['email', 'mobile', 'aa_number']) {
      const value = row.fields[field];
      if (!value) continue;
      const token = field + ':' + key(value);
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
      if (f[field] && duplicated.has(field + ':' + key(f[field]!)))
        errors.push(`${field}: duplicated in this workbook; fix every affected row.`);
    if (!/^09\d{9}$/.test(f.mobile ?? ''))
      errors.push('mobile: use 11 digits starting 09, including the leading zero.');
    if (
      kind === 'IST' &&
      !['vice_director', 'senior_sales_manager', 'sales_manager'].includes(f.position ?? '')
    )
      errors.push('position: choose an IST position.');
    if (kind === 'OST' && f.position !== 'ost') errors.push('position: must be ost.');
    const expected = MEMBER_UPLINE_ROLE[f.position as keyof typeof MEMBER_UPLINE_ROLE];
    const heads = members.filter(
      (m) =>
        m.status === 'active' &&
        key(m.email) === key(f.head_member ?? '') &&
        m.position === expected,
    );
    if (expected && heads.length !== 1)
      errors.push('head_member: choose the email of one existing active immediate head.');
    if (!expected && f.head_member) errors.push('head_member: a Vice Director has no head.');
    f.head_staff_id = heads.length === 1 ? heads[0]!.id : '';
    if (kind === 'OST' && heads.length === 1) {
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
        if (b.length !== 1) errors.push('barangay: not a unique barangay under this city.');
        else {
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
    if (kind === 'OST') f.expires_on = ostAnnualExpiry(f.starts_on ?? '');
    else if (
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
        'Accreditation: leave this tab blank for IST; normal creation determines its term.',
      );
    const parsed = memberWorkbookInput(kind, f, departmentId, 'Preview-only-not-a-password-1!');
    if (!parsed.success)
      errors.push(...parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    errors.push(...(await conflicts(f)));
    rows.push({ ...row, errors: [...new Set(errors)] });
  }
  return { kind, departmentId, rows };
}
