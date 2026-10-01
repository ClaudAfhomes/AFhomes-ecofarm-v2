import { toPdf, toXlsx, type XlsxColumn } from './report-export.js';

/**
 * Official VIP tier benefits (single source for PDFs, previews, and tests).
 * Mirrors migration 20261018000001 values: discount, validity = base + 2-year
 * extension, holder limit (Gold 2, else 1), yearly points x tranches, total
 * loyalty value, and the two binary flags.
 */
export const OFFICIAL_TIER_BENEFITS = {
  BRONZE: {
    tier: 'BRONZE',
    discountPercent: 15,
    baseValidityYears: 5,
    validityExtensionYears: 2,
    validityYears: 7,
    validityLabel: '5+2 = 7 years',
    cardholderLimit: 1,
    cardholderLabel: '1 holder',
    yearlyPoints: 10000,
    annualPointsTranches: 5,
    totalLoyaltyValue: '50000.00',
    priorityReservation: true,
    noMonthlyAnnualDues: true,
  },
  SILVER: {
    tier: 'SILVER',
    discountPercent: 20,
    baseValidityYears: 10,
    validityExtensionYears: 2,
    validityYears: 12,
    validityLabel: '10+2 = 12 years',
    cardholderLimit: 1,
    cardholderLabel: '1 holder',
    yearlyPoints: 20000,
    annualPointsTranches: 10,
    totalLoyaltyValue: '200000.00',
    priorityReservation: true,
    noMonthlyAnnualDues: true,
  },
  GOLD: {
    tier: 'GOLD',
    discountPercent: 25,
    baseValidityYears: 20,
    validityExtensionYears: 2,
    validityYears: 22,
    validityLabel: '20+2 = 22 years',
    cardholderLimit: 2,
    cardholderLabel: '2 holders maximum (secondary optional)',
    yearlyPoints: 25000,
    annualPointsTranches: 20,
    totalLoyaltyValue: '500000.00',
    priorityReservation: true,
    noMonthlyAnnualDues: true,
  },
} as const;

export type OfficialTier = keyof typeof OFFICIAL_TIER_BENEFITS;

export const isOfficialTier = (value: unknown): value is OfficialTier =>
  value === 'BRONZE' || value === 'SILVER' || value === 'GOLD';

export const officialTierBenefits = (tier: string) =>
  isOfficialTier(tier.toUpperCase()) ? OFFICIAL_TIER_BENEFITS[tier.toUpperCase() as OfficialTier] : null;

export const CUSTOMER_IMPORT_HEADERS = [
  'primary_last_name',
  'primary_first_name',
  'primary_middle_name',
  'primary_suffix',
  'primary_birth_date',
  'primary_sex',
  'primary_citizenship',
  'primary_civil_status',
  'primary_address_line_1',
  'primary_address_line_2',
  'primary_city_municipality',
  'primary_province',
  'primary_postal_code',
  'primary_landline',
  'primary_mobile',
  'primary_email',
  'primary_tin',
  'primary_occupation_business',
  'primary_office_business_address',
  'primary_business_industry',
  'primary_employed_position',
  'secondary_enabled',
  'secondary_last_name',
  'secondary_first_name',
  'secondary_middle_name',
  'secondary_suffix',
  'secondary_birth_date',
  'secondary_sex',
  'secondary_citizenship',
  'secondary_civil_status',
  'secondary_address_line_1',
  'secondary_address_line_2',
  'secondary_city_municipality',
  'secondary_province',
  'secondary_postal_code',
  'secondary_landline',
  'secondary_mobile',
  'secondary_email',
  'secondary_tin',
  'secondary_occupation_business',
  'secondary_office_business_address',
  'secondary_business_industry',
  'secondary_employed_position',
  'card_tier',
  'payment_scheme',
  'sales_manager',
  'vip_recommender',
  'recommender_contact',
  'recommender_email',
  'vip_referrer',
  'acquisition_channels',
  'consent_acknowledged',
  'acknowledgement_date',
  'primary_signature_status',
  'secondary_signature_status',
  'valid_id_received',
  'reservation_payment_proof_received',
] as const;

export const IST_IMPORT_HEADERS = [
  'sale_id',
  'customer_application_id',
  'reservation_date',
  'agreement_date',
  'revision_number',
  'monthly_amortization_start',
  'monthly_amortization_end',
  'payment_due_day',
  'primary_signature_status',
  'secondary_signature_status',
  'primary_name',
  'primary_address',
  'primary_contact_number',
  'primary_email',
  'primary_tin',
  'secondary_enabled',
  'secondary_name',
  'secondary_address',
  'secondary_contact_number',
  'secondary_email',
  'secondary_tin',
  'schedule_particular',
  'schedule_amount',
  'schedule_payment_date',
  'schedule_remarks',
  'payment_dates',
  'payment_remarks',
] as const;

const textColumns = (headers: readonly string[]): XlsxColumn[] =>
  headers.map((label) => ({
    label,
    type: 'text',
    width: Math.min(36, Math.max(16, label.length + 2)),
  }));

export const customerImportTemplate = () =>
  toXlsx('Customer Application', textColumns(CUSTOMER_IMPORT_HEADERS), [[]]);
export const istImportTemplate = () =>
  toXlsx('IST Agreement', textColumns(IST_IMPORT_HEADERS), [[]]);

export const customerApplicationXlsx = (fields: Record<string, string>) =>
  toXlsx('Customer Application', textColumns(CUSTOMER_IMPORT_HEADERS), [
    CUSTOMER_IMPORT_HEADERS.map((header) => fields[header] ?? ''),
  ]);

export const reservationAgreementXlsx = (fields: Record<string, string>) =>
  toXlsx('IST Agreement', textColumns(IST_IMPORT_HEADERS), [
    IST_IMPORT_HEADERS.map((header) => fields[header] ?? ''),
  ]);

const decodeXml = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

function storedZipEntry(bytes: Uint8Array, wanted: string): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.slice(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extraLength;
    if (name === wanted) {
      if (method !== 0) throw new Error('Only AF Homes generated XLSX files are supported');
      return decoder.decode(bytes.slice(start, start + size));
    }
    at = start + size;
  }
  return null;
}

/** Parse the first data row of an AF Homes generated XLSX. Never saves it. */
export function parseFormXlsx(bytes: Uint8Array): Record<string, string> {
  const xml = storedZipEntry(bytes, 'xl/worksheets/sheet1.xml');
  if (!xml) throw new Error('Spreadsheet worksheet is missing');
  const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((match) => match[1] ?? '');
  if (rows.length < 2) throw new Error('Spreadsheet must contain a header and one data row');
  const cells = (row: string) => {
    const values: string[] = [];
    for (const match of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const reference = /\br="([A-Z]+)\d+"/.exec(match[1] ?? '')?.[1] ?? '';
      let index = 0;
      for (const letter of reference) index = index * 26 + letter.charCodeAt(0) - 64;
      const body = match[2] ?? '';
      values[Math.max(0, index - 1)] = decodeXml(
        (/<t>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '').trim(),
      );
    }
    return values;
  };
  const headers = cells(rows[0]!);
  const values = cells(rows[1]!);
  return Object.fromEntries(
    headers.filter(Boolean).map((header, index) => [header, values[index] ?? '']),
  );
}

const requiredCustomer = [
  'primary_last_name',
  'primary_first_name',
  'primary_birth_date',
  'primary_address_line_1',
  'primary_city_municipality',
  'primary_province',
  'primary_mobile',
  'primary_email',
  'card_tier',
  'payment_scheme',
  'consent_acknowledged',
  'acknowledgement_date',
] as const;
const requiredIst = [
  'sale_id',
  'reservation_date',
  'agreement_date',
  'primary_signature_status',
  'primary_name',
  'primary_address',
  'primary_contact_number',
  'primary_email',
] as const;

const KNOWN_TIERS = ['BRONZE', 'SILVER', 'GOLD'];
const KNOWN_SCHEMES = [
  'spot_cash',
  'move_a',
  'installment_4_month',
  'move_b1_40_12',
  'move_b2_25_12',
];
const KNOWN_CHANNELS = new Set([
  'CMP',
  'DRP',
  'GDP Corporate',
  'Walk-In',
  'GDP Public Servant',
  'Referral',
  'FB Ads',
]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateFormImport(
  kind: 'customer_application' | 'reservation_agreement',
  fields: Record<string, string>,
) {
  const allowed = new Set<string>(
    kind === 'customer_application' ? CUSTOMER_IMPORT_HEADERS : IST_IMPORT_HEADERS,
  );
  const required = kind === 'customer_application' ? requiredCustomer : requiredIst;
  const errors: { field: string; message: string }[] = [];
  for (const key of Object.keys(fields))
    if (!allowed.has(key)) errors.push({ field: key, message: 'Unknown column' });
  for (const key of required)
    if (!fields[key]?.trim()) errors.push({ field: key, message: 'Required' });
  // Reject any attempt to import authoritative economics: those columns do not
  // exist in the template, so they surface as unknown columns above. The
  // explicit checks below keep the rejection legible in previews.
  for (const key of ['yearly_points', 'cash_price', 'total_price', 'benefit', 'commission'])
    if (fields[key] !== undefined)
      errors.push({ field: key, message: 'Authoritative economics cannot be imported' });
  const emailKey = kind === 'customer_application' ? 'primary_email' : 'primary_email';
  if (fields[emailKey] && !EMAIL_RE.test(fields[emailKey]))
    errors.push({ field: emailKey, message: 'Invalid email' });
  if (fields.recommender_email && !EMAIL_RE.test(fields.recommender_email))
    errors.push({ field: 'recommender_email', message: 'Invalid email' });
  if (fields.secondary_email && !EMAIL_RE.test(fields.secondary_email))
    errors.push({ field: 'secondary_email', message: 'Invalid email' });
  if (fields.primary_birth_date && !DATE_RE.test(fields.primary_birth_date))
    errors.push({ field: 'primary_birth_date', message: 'Use YYYY-MM-DD' });
  for (const key of [
    'acknowledgement_date',
    'reservation_date',
    'agreement_date',
    'monthly_amortization_start',
    'monthly_amortization_end',
    'schedule_payment_date',
  ])
    if (fields[key] && !DATE_RE.test(fields[key]))
      errors.push({ field: key, message: 'Use YYYY-MM-DD' });
  const phoneKey = kind === 'customer_application' ? 'primary_mobile' : 'primary_contact_number';
  if (fields[phoneKey] && fields[phoneKey].replace(/\D/g, '').length < 7)
    errors.push({ field: phoneKey, message: 'Invalid phone' });
  if (fields.secondary_contact_number && fields.secondary_contact_number.replace(/\D/g, '').length < 7)
    errors.push({ field: 'secondary_contact_number', message: 'Invalid phone' });
  if (fields.card_tier && !KNOWN_TIERS.includes(fields.card_tier.toUpperCase()))
    errors.push({ field: 'card_tier', message: 'Unknown tier' });
  if (fields.payment_scheme && !KNOWN_SCHEMES.includes(fields.payment_scheme))
    errors.push({ field: 'payment_scheme', message: 'Unknown payment scheme' });
  if (
    fields.secondary_enabled?.toLowerCase() === 'true' &&
    fields.card_tier?.toUpperCase() !== 'GOLD'
  )
    errors.push({ field: 'secondary_enabled', message: 'Secondary holder is Gold-only' });
  if (
    kind === 'reservation_agreement' &&
    fields.secondary_enabled?.toLowerCase() === 'true' &&
    !fields.secondary_name?.trim()
  )
    errors.push({ field: 'secondary_name', message: 'Required when secondary is enabled' });
  if (fields.sale_id && !UUID_RE.test(fields.sale_id))
    errors.push({ field: 'sale_id', message: 'Must be a sale UUID' });
  if (fields.customer_application_id && !UUID_RE.test(fields.customer_application_id))
    errors.push({ field: 'customer_application_id', message: 'Must be an application UUID' });
  if (
    fields.primary_signature_status &&
    !['pending', 'received'].includes(fields.primary_signature_status)
  )
    errors.push({ field: 'primary_signature_status', message: 'Must be pending or received' });
  if (
    fields.secondary_signature_status &&
    !['pending', 'received'].includes(fields.secondary_signature_status)
  )
    errors.push({ field: 'secondary_signature_status', message: 'Must be pending or received' });
  if (fields.payment_due_day && !/^(0?[1-9]|[12][0-9]|3[01])$/.test(fields.payment_due_day))
    errors.push({ field: 'payment_due_day', message: 'Must be 1-31' });
  if (fields.schedule_amount && !/^\d+(\.\d{1,2})?$/.test(fields.schedule_amount))
    errors.push({ field: 'schedule_amount', message: 'Must be an exact-decimal amount' });
  if (fields.acquisition_channels) {
    for (const channel of fields.acquisition_channels
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean))
      if (!KNOWN_CHANNELS.has(channel))
        errors.push({ field: 'acquisition_channels', message: `Unknown channel: ${channel}` });
  }
  return { kind, fields, errors, requiresReview: true as const };
}

/** OCR candidate mapping: recognized fields only, never a save/submit. */
export function mapOcrToApplicationDraft(
  extracted: Record<string, { value: string | null; confidence: number | null }>,
  current: Record<string, string>,
): { draft: Record<string, string>; detected: string[]; warnings: string[] } {
  const draft = { ...current };
  const detected: string[] = [];
  const warnings: string[] = [];
  const take = (from: string[], to: string) => {
    for (const key of from) {
      const value = extracted[key]?.value?.trim();
      if (value) {
        draft[to] = value;
        detected.push(to);
        if (
          extracted[key]?.confidence !== null &&
          (extracted[key]?.confidence ?? 1) < 0.6
        )
          warnings.push(`${to}: low confidence - please verify`);
        return;
      }
    }
  };
  take(['firstName'], 'primary_first_name');
  take(['middleName'], 'primary_middle_name');
  take(['lastName', 'fullName'], 'primary_last_name');
  take(['dateOfBirth'], 'primary_birth_date');
  take(['address'], 'primary_address_line_1');
  take(['idNumber', 'documentNumber'], 'primary_tin');
  return { draft, detected, warnings };
}

function benefitRows(tier: string): string[][] {
  const benefits = officialTierBenefits(tier);
  if (!benefits) return [['tier', tier]];
  return [
    ['tier', benefits.tier],
    ['discount', `${benefits.discountPercent}% priority reservation discount`],
    ['cardholders', benefits.cardholderLabel],
    ['validity', benefits.validityLabel],
    ['annual points', `${benefits.yearlyPoints.toLocaleString('en-PH')}/year x ${benefits.annualPointsTranches}`],
    ['total loyalty value', `PHP ${benefits.totalLoyaltyValue}`],
    ['priority reservation', benefits.priorityReservation ? 'Yes' : 'No'],
    ['monthly/annual dues', benefits.noMonthlyAnnualDues ? 'None' : 'See plan'],
  ];
}

const label = (key: string) => key.replaceAll('_', ' ');

export function officialFormPdf(
  title: string,
  fields: Record<string, string>,
  kind?: 'customer_application' | 'reservation_agreement',
): Uint8Array {
  const rows: string[][] = [];
  const section = (name: string) => rows.push([name, '']);
  if (kind === 'reservation_agreement') {
    const tier = fields.tier ?? fields.card_tier ?? 'BRONZE';
    section('AF HOMES ECOFARM');
    rows.push(['document', title]);
    section('RESERVATION HEADER');
    for (const key of [
      'reservation_number',
      'sale_id',
      'customer_application_id',
      'reservation_date',
      'agreement_date',
      'revision_number',
    ])
      if (fields[key] !== undefined) rows.push([label(key), fields[key] ?? '']);
    section('RESERVATION FEE PAYMENT DETAILS');
    for (const key of [
      'reservation_fee',
      'verified_payments',
      'total_payment_received',
      'balance',
      'down_payment',
      'monthly_amortization',
      'monthly_amortization_start',
      'monthly_amortization_end',
      'payment_due_day',
    ])
      if (fields[key] !== undefined) rows.push([label(key), fields[key] ?? '']);
    section('PRIMARY CARDHOLDER DETAILS');
    for (const key of [
      'primary_name',
      'primary_address',
      'primary_contact_number',
      'primary_email',
      'primary_tin',
    ])
      if (fields[key] !== undefined) rows.push([label(key), fields[key] ?? '']);
    section('SUPPLEMENTARY CARDHOLDER DETAILS - GOLD OPTIONAL');
    if (fields.secondary_enabled === 'true' || fields.secondary_name) {
      for (const key of [
        'secondary_name',
        'secondary_address',
        'secondary_contact_number',
        'secondary_email',
        'secondary_tin',
      ])
        if (fields[key] !== undefined) rows.push([label(key), fields[key] ?? '']);
    } else {
      rows.push(['supplementary holder', 'None (Gold optional; not required)']);
    }
    section('VIP PRIVILEGE CARD DETAILS');
    for (const row of benefitRows(tier)) rows.push(row);
    if (fields.payment_scheme) rows.push(['payment scheme', fields.payment_scheme]);
    section('OFFICIAL INCLUSIONS');
    if (fields.official_inclusions) rows.push(['inclusions', fields.official_inclusions]);
    else rows.push(['inclusions', 'Per official VIP tier benefits above']);
    section('TOTAL PRICE');
    for (const key of ['total_price', 'reservation_fee', 'balance'])
      if (fields[key] !== undefined) rows.push([label(key), fields[key] ?? '']);
    section('PAYMENT PLAN SUMMARY');
    for (const key of [
      'schedule_particular',
      'schedule_amount',
      'schedule_payment_date',
      'schedule_remarks',
      'payment_dates',
      'payment_remarks',
    ])
      if (fields[key] !== undefined) rows.push([label(key), fields[key] ?? '']);
    rows.push([
      'schedule note',
      'Scheduled obligations only. Actual received payments live in the payments table.',
    ]);
    section('CERTIFICATION AND SIGNATURES');
    rows.push(['primary signature', fields.primary_signature_status ?? 'pending']);
    rows.push(['secondary signature', fields.secondary_signature_status ?? '']);
    rows.push([
      'certification',
      'I certify the information is true and consent to verification and processing.',
    ]);
    rows.push(['primary signature line', '________________________  Date: __________']);
    rows.push(['secondary signature line', '________________________  Date: __________']);
    rows.push(['authorized seller line', '________________________  Date: __________']);
  } else {
    const tier = fields.card_tier ?? 'BRONZE';
    section('AF HOMES ECOFARM');
    rows.push(['document', title]);
    section('PRIMARY CARDHOLDER');
    for (const [key, value] of Object.entries(fields))
      if (key.startsWith('primary_')) rows.push([label(key), value]);
    section('SECONDARY CARDHOLDER - GOLD OPTIONAL');
    if (fields.secondary_enabled === 'true' || fields.secondary_last_name) {
      for (const [key, value] of Object.entries(fields))
        if (key.startsWith('secondary_')) rows.push([label(key), value]);
    } else {
      rows.push(['secondary holder', 'None (Gold optional; Bronze/Silver must not include one)']);
    }
    section('VIP PRIVILEGE CARD DETAILS');
    for (const row of benefitRows(tier)) rows.push(row);
    if (fields.payment_scheme) rows.push(['payment scheme', fields.payment_scheme]);
    section("VIP RECOMMENDER'S DETAILS");
    for (const key of [
      'sales_manager',
      'vip_recommender',
      'recommender_contact',
      'recommender_email',
      'vip_referrer',
    ])
      if (fields[key] !== undefined) rows.push([label(key), fields[key] ?? '']);
    section('CLIENT ACQUISITION CHANNEL');
    rows.push(['channels', fields.acquisition_channels ?? '']);
    section('CERTIFICATION');
    rows.push(['consent acknowledged', fields.consent_acknowledged ?? '']);
    rows.push(['acknowledgement date', fields.acknowledgement_date ?? '']);
    rows.push(['primary signature', fields.primary_signature_status ?? 'pending']);
    rows.push(['secondary signature', fields.secondary_signature_status ?? '']);
    section('RESERVATION REQUIREMENTS');
    rows.push(['valid id received', fields.valid_id_received ?? '']);
    rows.push(['reservation payment proof received', fields.reservation_payment_proof_received ?? '']);
  }
  return toPdf({
    title: `AF Homes Ecofarm\n${title}`,
    generatedAt: new Date().toISOString(),
    scopeLabel: 'Official form',
    windowLabel: 'Transaction snapshot',
    summaryLines: [
      'Official transaction snapshot. Selectable text; signatures and acknowledgements require human review.',
    ],
    headers: ['Field', 'Value'],
    rows,
  });
}
