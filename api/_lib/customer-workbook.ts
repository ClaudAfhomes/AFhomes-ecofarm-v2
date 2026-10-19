import {
  CUSTOMER_WORKBOOK_HEADERS,
  CUSTOMER_WORKBOOK_FIELDS as WORKBOOK_FIELDS,
  CUSTOMER_WORKBOOK_SHEETS,
  CUSTOMER_WORKBOOK_CHOICES,
  WORKBOOK_PAYMENT_SCHEMES,
  WORKBOOK_PAYMENT_METHODS,
  normalizeWorkbookName,
  companyApplicationPrefillSchema,
  emailSchema,
  CITIZENSHIP_OPTIONS,
  tinNumberSchema,
} from '@afhomes/contracts';
import { readWorkbook, readWorkbookParts } from './customer-xlsx.js';
import type { ImportFieldRow, ValidatedImportRow } from './customer-import.js';
import type { AddressProvider } from './address-provider.js';
import { resolvePostalCode } from './postal-reference.js';

export { WORKBOOK_FIELDS };
const workbookCitizenship = (value: string) =>
  CITIZENSHIP_OPTIONS.find((choice) => choice.toLowerCase() === value.trim().toLowerCase()) ??
  value.trim();
export function workbookDate(raw: string, date1904 = false): string {
  if (!raw) return '';
  let date = raw;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const serial = Math.floor(Number(raw));
    if (
      !Number.isSafeInteger(serial) ||
      serial < (date1904 ? 0 : 1) ||
      (!date1904 && serial === 60) ||
      serial > 2958465
    )
      return 'INVALID DATE';
    date = new Date(
      (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31)) +
        (date1904 ? serial : serial > 60 ? serial - 1 : serial) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
  } else {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    if (match) date = `${match[3]}-${match[1]!.padStart(2, '0')}-${match[2]!.padStart(2, '0')}`;
  }
  const parsed = new Date(date + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : 'INVALID DATE';
}

export function workbookApplicationPrefill(fields: Record<string, string>) {
  const holder = (prefix: string) => {
    const map: Record<string, string> = {
      first_name: 'firstName',
      middle_name: 'middleName',
      last_name: 'lastName',
      suffix: 'suffix',
      birth_date: 'birthDate',
      sex: 'sex',
      citizenship: 'citizenship',
      civil_status: 'civilStatus',
      address_line_1: 'permanentAddressLine1',
      address_line_2: 'permanentAddressLine2',
      province: 'province',
      city: 'cityMunicipality',
      barangay: 'barangay',
      province_code: 'provinceCode',
      city_code: 'cityMunicipalityCode',
      barangay_code: 'barangayCode',
      verified_postal_code: 'postalCode',
      landline: 'landline',
      mobile: 'mobile',
      email: 'email',
      tin: 'tinNumber',
      occupation: 'occupationBusinessName',
      business_address: 'officeBusinessAddress',
      position: 'employedPosition',
    };
    const result: Record<string, string> = {};
    for (const [source, target] of Object.entries(map)) {
      const value = fields[prefix + source];
      if (value && value !== 'N/A') result[target] = value === 'Seperated' ? 'Separated' : value;
    }
    const printedName = [result.firstName, result.middleName, result.lastName, result.suffix]
      .filter(Boolean)
      .join(' ');
    if (printedName) result.printedName = printedName;
    return result;
  };
  const primary = holder('');
  const secondary =
    fields.vip_tier === 'GOLD' &&
    Object.entries(fields).some(([key, value]) => key.startsWith('secondary_') && value)
      ? holder('secondary_')
      : null;
  const missingFields = [
    'Customer consent',
    'Acknowledgement date',
    'Primary signature',
    'Valid ID',
    'Reservation payment proof',
    'Finance review',
  ];
  for (const [name, value] of [
    ['Primary', primary],
    ['Supplementary', secondary],
  ] as const) {
    if (!value) continue;
    for (const key of [
      'firstName',
      'lastName',
      'birthDate',
      'permanentAddressLine1',
      'province',
      'cityMunicipality',
      'mobile',
      'email',
    ])
      if (!value[key]) missingFields.push(name + ': ' + key);
  }
  if (!fields.vip_tier) missingFields.push('VIP plan');
  if (!fields.stated_payment_scheme_code) missingFields.push('Payment scheme');
  return companyApplicationPrefillSchema.parse({
    primary,
    secondary,
    tier: fields.vip_tier || undefined,
    paymentScheme: fields.stated_payment_scheme_code || undefined,
    recommenderName: fields.recommender_name ?? '',
    recommenderContact: fields.recommender_contact ?? '',
    recommenderEmail: fields.recommender_email ?? '',
    salesManagerName: fields.sm_name ?? '',
    referrerName: fields.referrer_name ?? '',
    missingFields,
  });
}

export function parseCustomerWorkbook(
  bytes: Uint8Array,
): { rows: ImportFieldRow[]; unknownHeaders: string[] } | null {
  const parts = readWorkbookParts(bytes);
  const meta = new TextDecoder().decode(parts.get('xl/workbook.xml'));
  const date1904 = /\bdate1904=["'](?:1|true)["']/.test(meta);
  if (!/name=["']Primary["']/.test(meta)) return null;
  // The company workbook is the only layout that ships the PSGC reference
  // tabs its postal lookup reads. A guided sectioned workbook (README plus the
  // four entry tabs, no reference tabs) carries the same entry headers but
  // belongs to the sectioned-merge chain, so it is never claimed here.
  if (!/name=["']PSGC_[A-Za-z]+["']/.test(meta)) return null;
  // Shape probe: only a workbook whose Primary header row is the company
  // vocabulary is claimed. Any other workbook (a guided or legacy template,
  // an unrelated export) returns null so the sectioned-merge chain can decide
  // it; a workbook with the company headers but malformed content still
  // throws below.
  const primary = readWorkbook(parts, ['Primary']).get('Primary')!;
  if (
    primary[0]?.length !== CUSTOMER_WORKBOOK_HEADERS.Primary.length ||
    CUSTOMER_WORKBOOK_HEADERS.Primary.some((h, i) => primary[0]?.[i] !== h)
  )
    return null;
  const sheets = readWorkbook(parts, CUSTOMER_WORKBOOK_SHEETS);
  const rows = new Map<number, Record<string, string>>();
  for (const name of CUSTOMER_WORKBOOK_SHEETS) {
    const matrix = sheets.get(name)!;
    const headers = CUSTOMER_WORKBOOK_HEADERS[name];
    if (matrix[0]?.length !== headers.length || headers.some((h, i) => matrix[0]?.[i] !== h))
      throw new Error(`${name}: incorrect worksheet headers or order`);
    matrix.slice(1).forEach((cells, index) => {
      const values: Record<string, string> = {};
      cells.forEach((value, col) => {
        const field = WORKBOOK_FIELDS[name]![col];
        if (!field && value) throw new Error(`${name}: unexpected column at row ${index + 2}`);
        if (field && !['age', 'secondary_age'].includes(field)) values[field] = value;
      });
      // Formula/cache-only age/postal rows are not customer records.
      if (
        !Object.entries(values).some(
          ([f, v]) => !['postal_code', 'secondary_postal_code'].includes(f) && v.trim(),
        )
      )
        return;
      rows.set(index + 2, { ...rows.get(index + 2), ...values });
    });
  }
  return {
    unknownHeaders: [],
    rows: [...rows]
      .sort(([a], [b]) => a - b)
      .map(([rowNumber, values]) => {
        const fields: Record<string, string> = Object.fromEntries(
          Object.values(WORKBOOK_FIELDS)
            .flat()
            .filter((field) => !['age', 'secondary_age'].includes(field))
            .map((field) => [field, values[field] ?? '']),
        );
        for (const key of ['birth_date', 'secondary_birth_date', 'stated_date'])
          fields[key] = workbookDate(fields[key] ?? '', date1904);
        for (const key of ['email', 'secondary_email', 'recommender_email'])
          fields[key] = (fields[key] ?? '').trim().toLowerCase();
        for (const key of ['citizenship', 'secondary_citizenship'])
          fields[key] = workbookCitizenship(fields[key] ?? '');
        for (const key of ['suffix', 'secondary_suffix'])
          if (fields[key] === 'N/A') fields[key] = '';
        for (const key of [
          'first_name',
          'last_name',
          'middle_name',
          'secondary_first_name',
          'secondary_last_name',
          'secondary_middle_name',
          'vd_name',
          'ssm_name',
          'sm_name',
          'referrer_name',
          'recommender_name',
        ])
          fields[key] = normalizeWorkbookName(fields[key] ?? '');
        // These labels are claims, never membership/payment instructions.
        return {
          rowNumber,
          fields: { ...fields, source_status: 'Pending', workbook_format: 'company_v1' },
        };
      }),
  };
}

export function sameWorkbookIdentity(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(
    (key) =>
      (['tin', 'secondary_tin'].includes(key) && !a[key]) || (a[key] ?? '') === (b[key] ?? ''),
  );
}

export function validateWorkbookFields(
  fields: Record<string, string>,
  row: ValidatedImportRow,
): void {
  if (fields.suffix === 'N/A') row.errors = row.errors.filter((e) => e.field !== 'suffix');
  const err = (field: string, message: string) => row.errors.push({ field, message });
  for (const prefix of ['', 'secondary_']) {
    const key = prefix + 'citizenship';
    if (fields[key]) fields[key] = workbookCitizenship(fields[key]!);
    const tin = fields[prefix + 'tin'];
    if (tin && !tinNumberSchema.safeParse(tin).success)
      err(
        prefix + 'tin',
        `TIN has ${tin.replace(/\D/g, '').length} digits. Enter the complete 9-digit TIN (123-456-789), optionally followed by a 3-5 digit branch suffix. TIN is optional; leave it blank if unavailable. Never pad an incomplete TIN.`,
      );
  }
  if (fields.recommender_email && !emailSchema.safeParse(fields.recommender_email).success)
    err('recommender_email', 'Invalid email');
  for (const [field, choices] of Object.entries(CUSTOMER_WORKBOOK_CHOICES)) {
    const keys =
      field === 'status'
        ? ['stated_status']
        : field === 'gender'
          ? ['sex', 'secondary_sex']
          : ['suffix', 'civil_status'].includes(field)
            ? [field, 'secondary_' + field]
            : [field];
    for (const key of keys)
      if (fields[key] && !(choices as readonly string[]).includes(fields[key]!))
        err(key, 'Unsupported company dropdown value');
  }
  for (const field of ['stated_regular_price', 'stated_discount', 'stated_total', 'stated_rf'])
    if (fields[field] && !/^(0|[1-9][0-9]*)(\.\d{1,2})?$/.test(fields[field]!))
      err(field, 'Use non-negative exact-decimal text');
  if (fields.stated_date && fields.stated_date === 'INVALID DATE')
    err('stated_date', 'Use a real Excel date, YYYY-MM-DD or MM/DD/YYYY');
  if (
    Object.entries(fields).some(([key, value]) => key.startsWith('secondary_') && value) &&
    fields.vip_tier !== 'GOLD'
  )
    err('secondary_first_name', 'Supplementary holder is Gold-only');
  if (row.normalized) {
    row.normalized.person.phone = fields.mobile || null;
    row.normalized.secondaryNote = null;
    row.normalized.person.suffix = fields.suffix === 'N/A' ? null : fields.suffix || null;
  }
  fields.stated_payment_scheme_code =
    WORKBOOK_PAYMENT_SCHEMES[fields.stated_payment_scheme ?? ''] ?? '';
  fields.stated_payment_method_code =
    WORKBOOK_PAYMENT_METHODS[fields.stated_payment_method ?? ''] ?? '';
  row.warnings.push({
    field: 'stated_status',
    message:
      'Company-stated status and amounts do not verify payment, activate membership or complete refunds. Consent, signatures, identity documents and Finance review remain incomplete.',
  });
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
export type WorkbookStaffMatch = {
  staff_id: string;
  full_name: string;
  role_slug: string;
  ancestor_ids: string[];
  match_count: number;
  aa_number?: string | null;
};
export function resolveWorkbookStaff(
  fields: Record<string, string>,
  matches: WorkbookStaffMatch[],
  row: Pick<ValidatedImportRow, 'errors' | 'warnings'>,
): void {
  const expected: Record<string, string> = {
    vd_name: 'vice_director',
    ssm_name: 'senior_sales_manager',
    sm_name: 'sales_manager',
    referrer_name: 'ost',
    recommender_name: 'ost',
  };
  const resolved = new Map<string, WorkbookStaffMatch>();
  const describe = (match: WorkbookStaffMatch) =>
    `${match.full_name} [${match.aa_number || match.staff_id}]`;
  const fail = (field: string, message: string) => row.errors.push({ field, message });
  for (const [field, role] of Object.entries(expected)) {
    if (!fields[field]) continue;
    const input = fields[field]!.trim();
    const id = fields[field.replace('_name', '_staff_id')];
    const aa = fields[field.replace('_name', '_aa_number')];
    const options = matches.filter(
      (match) =>
        (!id || match.staff_id.toLowerCase() === id.toLowerCase()) &&
        (!aa || match.aa_number?.toUpperCase() === aa.toUpperCase()) &&
        (nameKey(match.full_name) === nameKey(input) ||
          match.staff_id.toLowerCase() === input.toLowerCase() ||
          match.aa_number?.toUpperCase() === input.toUpperCase()),
    );
    const match = options[0];
    if (options.length !== 1 || !match || match.role_slug !== role) {
      fail(
        field,
        `Expected one existing registered ${role === 'ost' ? 'OST' : role.replaceAll('_', ' ')}. ${options.length > 1 ? 'Name is ambiguous; use the canonical staff ID or AAO/AAI number.' : 'No matching identity with the required role; verify the staff ID or AAO/AAI number. No new account is needed.'}`,
      );
      continue;
    }
    const canonical =
      id ||
      aa ||
      match.staff_id.toLowerCase() === input.toLowerCase() ||
      match.aa_number?.toUpperCase() === input.toUpperCase();
    if (!canonical && Number(match.match_count) !== 1) {
      fail(
        field,
        'Name is ambiguous; use the canonical staff ID or AAO/AAI number. No identity was assumed.',
      );
      continue;
    }
    if (
      new Set(match.ancestor_ids).size !== match.ancestor_ids.length ||
      match.ancestor_ids.includes(match.staff_id)
    ) {
      fail(
        field,
        'Registered genealogy contains a cycle or conflicting placements; manual review required.',
      );
      continue;
    }
    fields[field.replace('_name', '_staff_id')] = match.staff_id;
    if (match.aa_number) fields[field.replace('_name', '_aa_number')] = match.aa_number;
    resolved.set(field, match);
    // The unchanged confirmation RPC still validates unique registered names.
    if (Number(match.match_count) !== 1) {
      fail(
        field,
        `Identity resolved to ${describe(match)}, but database confirmation still requires a unique registered name. Held for review; no duplicate account will be created.`,
      );
    } else if (nameKey(input) !== nameKey(match.full_name)) {
      fields[field.replace('_name', '_reference')] = input;
      fields[field] = match.full_name;
      row.warnings.push({
        field,
        message: `${input} resolved to ${describe(match)}; the registered name is used for confirmation. The original reference is preserved.`,
      });
    }
  }
  const lineage = (field: string) => {
    const member = resolved.get(field);
    if (!member) return null;
    const ancestors = member.ancestor_ids.map((id) => matches.find((m) => m.staff_id === id));
    const ranks: Record<string, number> = {
      vice_director: 0,
      senior_sales_manager: 1,
      sales_manager: 2,
      ost: 3,
    };
    let rank = ranks[member.role_slug]!;
    for (const ancestor of ancestors) {
      if (
        !ancestor ||
        ranks[ancestor.role_slug] === undefined ||
        ranks[ancestor.role_slug]! >= rank
      ) {
        fail(
          field,
          'Registered genealogy is incomplete or has invalid role order; no upperlines were inferred.',
        );
        return null;
      }
      rank = ranks[ancestor.role_slug]!;
    }
    const root = ancestors.at(-1) ?? member;
    if (root.role_slug !== 'vice_director') {
      fail(field, 'Registered genealogy has no verified VD root; manual review required.');
      return null;
    }
    if (member.role_slug === 'ost') {
      const stem = field.replace('_name', '');
      for (const [key, role] of Object.entries({
        vd: 'vice_director',
        ssm: 'senior_sales_manager',
        sm: 'sales_manager',
      })) {
        const upper = ancestors.find((a) => a?.role_slug === role);
        if (upper) fields[`${stem}_${key}_staff_id`] = upper.staff_id;
        else delete fields[`${stem}_${key}_staff_id`];
      }
      row.warnings.push({
        field,
        message: `${field === 'referrer_name' ? 'Referrer' : 'VIP Recommender'}: ${describe(member)}. Actual lineage (direct upline first): ${ancestors.map((a) => `${a!.role_slug.replaceAll('_', ' ')} ${describe(a!)}`).join(' → ')}. Missing SM/SSM levels are not inferred.`,
      });
    }
    return { member, ancestors, root };
  };
  const referrer = lineage('referrer_name');
  const recommender = lineage('recommender_name');
  const managers = ['vd_name', 'ssm_name', 'sm_name'].flatMap((field) => {
    const match = resolved.get(field);
    return match ? [{ field, match }] : [];
  });
  for (let i = 0; i < managers.length; i++) {
    const { field, match } = managers[i]!;
    for (const parent of managers.slice(0, i))
      if (!match.ancestor_ids.includes(parent.match.staff_id))
        fail(
          field,
          `${describe(match)} is not under workbook ${describe(parent.match)} in the registered genealogy.`,
        );
    if (referrer && !referrer.member.ancestor_ids.includes(match.staff_id)) {
      const actual = referrer.ancestors.find((a) => a?.role_slug === match.role_slug);
      fail(
        field,
        `Workbook ${describe(match)} conflicts with Referrer ${describe(referrer.member)}: registered ${match.role_slug.replaceAll('_', ' ')} is ${actual ? describe(actual) : 'not present (direct placement skips this level)'}. No genealogy was replaced.`,
      );
    }
  }
  if (referrer && recommender) {
    if (referrer.root.staff_id !== recommender.root.staff_id)
      fail(
        'recommender_name',
        `Referrer and VIP Recommender are in different registered genealogy trees: Referrer VD ${describe(referrer.root)}; VIP Recommender VD ${describe(recommender.root)}. Review the intended tree; no genealogy was changed.`,
      );
    else
      row.warnings.push({
        field: 'recommender_name',
        message:
          'Referrer and VIP Recommender share the same registered VD tree. Different immediate uplines are allowed; each OST lineage was checked separately.',
      });
  } else if (!fields.recommender_name) {
    row.warnings.push({
      field: 'recommender_name',
      message:
        'VIP Recommender not supplied; no OST identity or genealogy relationship was assumed.',
    });
  }
}
/** Resolve only unique exact official names, scoped to the selected parent. */
export async function resolveWorkbookGeography(
  fields: Record<string, string>,
  provider: AddressProvider,
  row: ValidatedImportRow,
): Promise<void> {
  for (const prefix of ['', 'secondary_']) {
    if (!['province', 'city', 'barangay', 'postal_code'].some((k) => fields[prefix + k])) continue;
    const err = (field: string, message: string) =>
      row.errors.push({ field: prefix + field, message });
    try {
      const provinces = (await provider.provinces()).filter(
        (p) => nameKey(p.name) === nameKey(fields[prefix + 'province'] ?? ''),
      );
      if (provinces.length !== 1) {
        err('province', 'Unknown or ambiguous province/PSGC geographic scope');
        continue;
      }
      const province = provinces[0]!;
      const localities = (await provider.localities(province.code)).filter(
        (p) => nameKey(p.name) === nameKey(fields[prefix + 'city'] ?? ''),
      );
      if (localities.length !== 1) {
        err('city', 'Unknown or ambiguous city under this province');
        continue;
      }
      const locality = localities[0]!;
      const barangays = (await provider.barangays(locality.code)).filter(
        (p) => nameKey(p.name) === nameKey(fields[prefix + 'barangay'] ?? ''),
      );
      if (barangays.length !== 1) {
        err('barangay', 'Unknown or ambiguous barangay under this city');
        continue;
      }
      fields[prefix + 'province_code'] = province.code;
      fields[prefix + 'city_code'] = locality.code;
      fields[prefix + 'barangay_code'] = barangays[0]!.code;
      fields[prefix + 'province'] = province.name;
      fields[prefix + 'city'] = locality.name;
      fields[prefix + 'barangay'] = barangays[0]!.name;
      delete fields[prefix + 'verified_postal_code'];
      const postal = resolvePostalCode(province.name, locality.name, barangays[0]!.name);
      const published = postal.status === 'matched' ? postal.postalCode : undefined;
      const candidate = fields[prefix + 'postal_code'] ?? '';
      if (!published || !/^\d{4}$/.test(published)) {
        err(
          'postal_code',
          'No single usable ZIP published by the address provider; manual review required',
        );
      } else if (candidate && candidate !== published) {
        err(
          'postal_code',
          `Workbook ZIP ${candidate || '(blank)'} disagrees with provider ZIP ${published}; review required, no automatic replacement`,
        );
      } else {
        fields[prefix + 'verified_postal_code'] = published;
      }
    } catch {
      err('province', 'Address reference is unavailable; retry validation');
    }
  }
}
