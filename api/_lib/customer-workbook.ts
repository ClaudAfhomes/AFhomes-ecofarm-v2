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
} from '@afhomes/contracts';
import { readWorkbook, readWorkbookParts } from './customer-xlsx.js';
import type { ImportFieldRow, ValidatedImportRow } from './customer-import.js';
import type { AddressProvider } from './address-provider.js';
import { resolvePostalCode } from './postal-reference.js';

export { WORKBOOK_FIELDS };
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
};
export function resolveWorkbookStaff(
  fields: Record<string, string>,
  matches: WorkbookStaffMatch[],
  row: ValidatedImportRow,
): void {
  const expected: Record<string, string | null> = {
    vd_name: 'vice_director',
    ssm_name: 'senior_sales_manager',
    sm_name: 'sales_manager',
    referrer_name: null,
  };
  const resolved: WorkbookStaffMatch[] = [];
  for (const [field, role] of Object.entries(expected)) {
    if (!fields[field]) continue;
    const options = matches.filter((match) => nameKey(match.full_name) === nameKey(fields[field]!));
    const match = options[0];
    if (
      options.length !== 1 ||
      !match ||
      Number(match.match_count) !== 1 ||
      (role && match.role_slug !== role) ||
      !['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'].includes(match.role_slug)
    ) {
      row.errors.push({
        field,
        message:
          'Unknown, ambiguous or wrong-role registered staff identity; manual review required',
      });
      continue;
    }
    if (
      new Set(match.ancestor_ids).size !== match.ancestor_ids.length ||
      resolved.some(
        (parent) =>
          parent.staff_id !== match.staff_id && !match.ancestor_ids.includes(parent.staff_id),
      )
    ) {
      row.errors.push({
        field,
        message:
          'Registered seller hierarchy contradicts the supplied managers; manual review required',
      });
      continue;
    }
    fields[field.replace('_name', '_staff_id')] = match.staff_id;
    resolved.push(match);
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
