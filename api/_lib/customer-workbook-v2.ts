import {
  WORKFLOW_COLUMNS,
  LEGACY_WORKFLOW_COLUMNS,
  PREVIOUS_WORKFLOW_COLUMNS,
  WORKFLOW_TEMPLATE_VERSION,
  WORKFLOW_MAPPING_VERSION,
  workbookCustomerV2Schema,
  workbookPaymentClaimSchema,
  WORKBOOK_PAYMENT_SCHEMES,
  type WorkflowSheet,
  type WorkbookCustomerV2,
  type WorkbookPaymentClaim,
} from '@afhomes/contracts';
import { addMoney, subtractMoney, compareMoney } from '@afhomes/shared';
import { readWorkbook, readWorkbookParts, readWorkbookCustomProperties } from './customer-xlsx.js';
import { workbookDate } from './customer-workbook.js';
import { createHash } from 'node:crypto';
import { resolvePostalCode } from './postal-reference.js';

const key = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const decoder = new TextDecoder('utf-8', { fatal: true });
const sheets = Object.keys(WORKFLOW_COLUMNS) as WorkflowSheet[];
const methods: Record<string, string> = {
  cash: 'cash',
  'bank transfer': 'bank_transfer',
  gcash: 'gcash',
  maya: 'maya',
  card: 'card',
  cheque: 'cheque',
};
const purposes: Record<string, string> = {
  'reservation fee': 'reservation',
  'down payment': 'down_payment',
  installment: 'installment',
  'full payment': 'full',
};
const money = (value: string, label: string) => {
  if (!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value))
    throw new Error(`${label}: use a non-negative exact-decimal amount`);
  return addMoney(value, '0.00');
};
function dateInput(
  fields: Record<string, string>,
  dateField: string,
  prefix: string,
  date1904: boolean,
) {
  const raw = fields[dateField] ?? '';
  const direct = raw ? workbookDate(raw, date1904) : '';
  const helper = ['year', 'month', 'day'].map((part) => fields[`${prefix}_${part}`] ?? '');
  if (helper.some(Boolean) && !helper.every(Boolean))
    throw new Error(`${dateField}: complete all date helper fields`);
  const composed = helper.every(Boolean)
    ? workbookDate(
        `${helper[0]!.padStart(4, '0')}-${helper[1]!.padStart(2, '0')}-${helper[2]!.padStart(2, '0')}`,
      )
    : '';
  if (direct === 'INVALID DATE' || composed === 'INVALID DATE')
    throw new Error(`${dateField}: use a real date`);
  if (direct && composed && direct !== composed)
    throw new Error(`${dateField}: direct date conflicts with date helper`);
  fields[dateField] = direct || composed;
}

/** Read keyed sheets only; source claims never become financial transactions here. */
export function parseCustomerWorkbookV2(
  bytes: Uint8Array,
): { rows: WorkbookCustomerV2[]; unknownHeaders: string[] } | null {
  const parts = readWorkbookParts(bytes);
  const metadata = readWorkbookCustomProperties(parts);
  const property = (name: string) => metadata.get(name) ?? '';
  const templateVersion = property('AFHomesTemplate');
  const mappingVersion = property('AFHomesMappingVersion');
  const columnsBySheet =
    mappingVersion === '1'
      ? LEGACY_WORKFLOW_COLUMNS
      : mappingVersion === '2'
        ? PREVIOUS_WORKFLOW_COLUMNS
        : WORKFLOW_COLUMNS;
  // Read workbook to get sheet names first
  const workbook = decoder.decode(parts.get('xl/workbook.xml')!);
  const names = [...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*\bname=["']([^"']+)["']/g)].map(
    (m) => m[1]!,
  );
  const hasV2Sheets = names.some(
    (name) =>
      sheets.includes(name as WorkflowSheet) || ['Start Here', 'Reference Lists'].includes(name),
  );
  // If workbook has v2 sheet structure, it must have valid v2 metadata
  if (hasV2Sheets) {
    if (templateVersion === '' || templateVersion !== WORKFLOW_TEMPLATE_VERSION) {
      throw new Error(
        templateVersion === ''
          ? 'Missing workbook template version; download the current template'
          : `Unsupported workbook template version: ${templateVersion}; download the current template`,
      );
    }
    if (!['1', '2', WORKFLOW_MAPPING_VERSION].includes(mappingVersion))
      throw new Error('Unsupported workbook mapping version; download the current template');
  } else if (templateVersion === '') {
    // Not a v2 workbook - return null so legacy parser can handle it
    return null;
  } else if (templateVersion !== WORKFLOW_TEMPLATE_VERSION) {
    throw new Error(
      `Unsupported workbook template version: ${templateVersion}; download the current template`,
    );
  } else if (!['1', '2', WORKFLOW_MAPPING_VERSION].includes(mappingVersion)) {
    throw new Error('Unsupported workbook mapping version; download the current template');
  }
  for (const [path, content] of parts) {
    if (/externalLinks\/|connections\.xml$|vbaProject|activeX\/|embeddings\//i.test(path))
      throw new Error('External references or executable workbook content are unsupported');
    if (
      path.endsWith('.rels') &&
      /\bTargetMode\s*=\s*["']External["']/i.test(decoder.decode(content))
    )
      throw new Error('External workbook relationships are unsupported');
  }
  const date1904 = /\bdate1904=["'](?:1|true)["']/.test(workbook);
  if (
    names.some(
      (name) =>
        !sheets.includes(name as WorkflowSheet) &&
        ![
          'Start Here',
          'Reference Lists',
          'Address Lists',
          'Postal Codes',
          'Examples Guide',
        ].includes(name),
    )
  )
    throw new Error('Unknown worksheet; remove unmapped data before confirmation');
  const ignored = Object.fromEntries(
    sheets.map((s) => [
      s,
      columnsBySheet[s].flatMap((c, i) =>
        c.disposition === 'calculated' || ['birth_date', 'date', 'postal_code'].includes(c.key)
          ? [i + 1]
          : [],
      ),
    ]),
  );
  const matrices = readWorkbook(
    parts,
    names,
    false,
    ignored,
    (_sheet, _column, _row, formula) => {
      const text = formula.replace(/"(?:[^"]|"")*"/g, '""');
      const functions = [...text.matchAll(/([\w.]+)\s*\(/g)].map((m) => m[1]!.toUpperCase());
      const internal = text.replace(
        /'(Customers|Supplementary Holders|Sales Team|Payments|Reference Lists|Address Lists|Postal Codes)'!/g,
        '',
      );
      if (
        /[[\]|!]/.test(internal) ||
        /(?:https?:|file:|\\\\)/i.test(formula) ||
        functions.some(
          (f) =>
            ![
              'IF',
              'IFERROR',
              'AND',
              'OR',
              'SUMIF',
              'SUMIFS',
              'COUNTIF',
              'COUNTIFS',
              'DATE',
              'DATEDIF',
              'TODAY',
              'ROUND',
              'MIN',
              'MAX',
              'VLOOKUP',
            ].includes(f),
        )
      )
        throw new Error('Unsafe or external calculated formula');
      return '';
    },
    ['Address Lists', 'Postal Codes'],
  );
  const rowsBySheet = new Map<WorkflowSheet, Record<string, string>[]>();
  for (const sheet of sheets) {
    const matrix = matrices.get(sheet)!;
    const columns = columnsBySheet[sheet];
    if (matrix[0]?.length !== columns.length || columns.some((c, i) => matrix[0]![i] !== c.header))
      throw new Error(`${sheet}: incorrect or unmapped required headers`);
    const rows: Record<string, string>[] = [];
    for (const [index, values] of matrix.slice(1).entries()) {
      if (values.length > columns.length && values.slice(columns.length).some((v) => v.trim()))
        throw new Error(`${sheet} row ${index + 2}: unmapped column contains data`);
      const fields = Object.fromEntries(columns.map((c, i) => [c.key, (values[i] ?? '').trim()]));
      if (!columns.some((c) => c.disposition !== 'calculated' && fields[c.key])) continue;
      if (mappingVersion !== '1' && sheet === 'Customers')
        fields.customer_key = fields.purchase_reference ?? '';
      if (!fields.customer_key)
        throw new Error(
          `${sheet} row ${index + 2}: ${mappingVersion === '1' ? 'Customer key' : 'Purchase reference'} is required`,
        );
      rows.push(fields);
    }
    rowsBySheet.set(sheet, rows);
  }
  const result = new Map<string, WorkbookCustomerV2>();
  const purchases = new Set<string>();
  for (const fields of rowsBySheet.get('Customers')!) {
    const customerKey = fields.customer_key!;
    fields.ra_number = fields.customer_id ?? '';
    if (fields.ra_number.startsWith('AF-CUS-')) fields.customer_number = fields.ra_number;
    if (result.has(key(customerKey))) throw new Error(`Duplicate customer key: ${customerKey}`);
    if (!fields.purchase_reference)
      throw new Error(`Customers ${customerKey}: Purchase reference is required`);
    if (purchases.has(key(fields.purchase_reference)))
      throw new Error(`Duplicate purchase reference: ${fields.purchase_reference}`);
    purchases.add(key(fields.purchase_reference));
    dateInput(fields, 'birth_date', 'birth', date1904);
    if (fields.contract_date) {
      fields.contract_date = workbookDate(fields.contract_date, date1904);
      if (fields.contract_date === 'INVALID DATE')
        throw new Error('Contract date: use a real date');
    }
    const tier = fields.vip_tier?.toUpperCase() ?? '';
    if (tier && !['GOLD', 'SILVER', 'BRONZE'].includes(tier))
      throw new Error('VIP plan: choose Gold, Silver or Bronze');
    fields.vip_tier = tier;
    if (fields.stated_payment_scheme) {
      const aliases: Record<string, string> = {
        'move b1 (40% initial / 12 months)': 'Move b1 40 12',
        'move b2 (25% initial / 12 months)': 'Move b2 25 12',
        '4-month installment': 'Installment 4_month',
      };
      const value = aliases[key(fields.stated_payment_scheme)] ?? fields.stated_payment_scheme;
      const option = Object.keys(WORKBOOK_PAYMENT_SCHEMES).find((s) => key(s) === key(value));
      if (!option) throw new Error('Payment terms: choose a listed payment scheme');
      fields.stated_payment_scheme = option;
    }
    for (const name of ['stated_regular_price', 'stated_discount', 'stated_rf'])
      if (fields[name]) fields[name] = money(fields[name]!, name);
    if (fields.stated_regular_price) {
      const discount = fields.stated_discount || '0.00';
      if (compareMoney(discount, fields.stated_regular_price) > 0)
        throw new Error('Discount cannot exceed contract price');
      fields.stated_total = subtractMoney(fields.stated_regular_price, discount);
      if (fields.stated_rf && compareMoney(fields.stated_rf, fields.stated_total) > 0)
        throw new Error('Included reservation fee cannot exceed contract total');
    } else fields.stated_total = '';
    fields.workbook_format = WORKFLOW_TEMPLATE_VERSION;
    fields.source_status = 'Pending';
    result.set(key(customerKey), {
      customerKey,
      purchaseReference: fields.purchase_reference,
      customerId: fields.customer_id || null,
      fields,
      payments: [],
    });
  }
  for (const sheet of ['Supplementary Holders', 'Sales Team', 'Payments'] as const) {
    const seen = new Set<string>();
    for (const fields of rowsBySheet.get(sheet)!) {
      const id = key(fields.customer_key!);
      const customer = result.get(id);
      if (!customer) throw new Error(`${sheet}: Unknown customer key ${fields.customer_key}`);
      if (sheet === 'Payments') {
        dateInput(fields, 'date', 'payment', date1904);
        const amount = money(fields.amount ?? '', 'Payment amount');
        if (compareMoney(amount, '0.00') <= 0) throw new Error('Payment amount must be positive');
        // Exclude row position and notes so sorting and repeat downloads retain the same identity.
        const automaticKey =
          'AUTO-' +
          createHash('sha256')
            .update(
              JSON.stringify([
                key(customer.purchaseReference),
                purposes[key(fields.purpose ?? '')],
                amount,
                fields.date,
                methods[key(fields.method ?? '')],
                key(fields.reference ?? ''),
              ]),
            )
            .digest('hex');
        const paymentKey = fields.payment_key?.trim() || automaticKey;
        const source = id + ':' + key(paymentKey);
        if (seen.has(source))
          throw new Error(
            'Duplicate payment claim. If these are genuinely separate identical payments, give each a distinct Payment claim reference.',
          );
        seen.add(source);
        const claim: WorkbookPaymentClaim = workbookPaymentClaimSchema.parse({
          paymentKey,
          customerKey: customer.customerKey,
          purpose: purposes[key(fields.purpose ?? '')],
          amount,
          date: fields.date,
          method: methods[key(fields.method ?? '')],
          reference: fields.reference ?? '',
          notes: fields.notes ?? '',
        });
        customer.payments.push(claim);
      } else {
        if (seen.has(id)) throw new Error(`${sheet}: duplicate customer key`);
        seen.add(id);
        if (sheet === 'Supplementary Holders') {
          if (customer.fields.vip_tier !== 'GOLD')
            throw new Error('Supplementary holder is Gold-only');
          dateInput(fields, 'birth_date', 'birth', date1904);
          for (const [field, value] of Object.entries(fields))
            if (field !== 'customer_key') customer.fields['secondary_' + field] = value;
        } else
          for (const [field, value] of Object.entries(fields))
            if (field !== 'customer_key') customer.fields[field] = value;
      }
    }
  }
  for (const customer of result.values()) {
    if (mappingVersion !== '1') {
      for (const prefix of ['', 'secondary_']) {
        const postal = resolvePostalCode(
          customer.fields[prefix + 'province'] ?? '',
          customer.fields[prefix + 'city'] ?? '',
          customer.fields[prefix + 'barangay'] ?? '',
        );
        const supplied = customer.fields[prefix + 'postal_code'];
        if (postal.status === 'matched') {
          if (supplied && supplied !== postal.postalCode)
            throw new Error('Postal code conflicts with the selected address');
          customer.fields[prefix + 'postal_code'] = postal.postalCode;
        }
      }
    }
    for (const field of ['vd_name', 'ssm_name', 'sm_name', 'referrer_name', 'recommender_name']) {
      const choice = /^(.+) \[(AA[IO]\d{8})\]$/i.exec(customer.fields[field] ?? '');
      if (choice) {
        customer.fields[field.replace('_name', '_expected_name')] = choice[1]!.trim();
        customer.fields[field] = choice[2]!.toUpperCase();
      }
    }
    const total = customer.payments.reduce((sum, p) => addMoney(sum, p.amount), '0.00');
    customer.fields.claimed_payment_total = total;
    if (customer.fields.stated_total) {
      if (compareMoney(total, customer.fields.stated_total) > 0)
        throw new Error('Payment claims exceed contract total; reconcile before import');
      customer.fields.claimed_balance = subtractMoney(customer.fields.stated_total, total);
    } else customer.fields.claimed_balance = '';
  }
  return {
    rows: [...result.values()].map((r) => workbookCustomerV2Schema.parse(r)),
    unknownHeaders: [],
  };
}
