import {
  WORKFLOW_COLUMNS,
  WORKFLOW_V3_COLUMNS,
  WORKFLOW_V4_COLUMNS,
  WORKFLOW_V5_COLUMNS,
  WORKFLOW_V6_COLUMNS,
  LEGACY_WORKFLOW_COLUMNS,
  PREVIOUS_WORKFLOW_COLUMNS,
  WORKFLOW_TEMPLATE_VERSION,
  WORKFLOW_MAPPING_VERSION,
  WORKFLOW_REVIEW_HEADERS,
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

export type WorkflowReviewIssue = {sheet: WorkflowSheet; row: number; field: string; column: number; message: string};
export type WorkflowSource = {sheet: WorkflowSheet; row: number; fields: Record<string,string>};
/** Read keyed sheets only; source claims never become financial transactions here. */
export function parseCustomerWorkbookV2(
  bytes: Uint8Array,
  options: { collectErrors?: boolean } = {},
): { rows: WorkbookCustomerV2[]; unknownHeaders: string[]; issues: WorkflowReviewIssue[]; sources: WorkflowSource[][] } | null {
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
        : mappingVersion === '3'
          ? WORKFLOW_V3_COLUMNS
          : mappingVersion === '4' ? WORKFLOW_V4_COLUMNS : mappingVersion === '5' ? WORKFLOW_V5_COLUMNS : mappingVersion === '6' ? WORKFLOW_V6_COLUMNS : WORKFLOW_COLUMNS;
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
    if (!['1', '2', '3', '4', '5', '6', WORKFLOW_MAPPING_VERSION].includes(mappingVersion))
      throw new Error('Unsupported workbook mapping version; download the current template');
  } else if (templateVersion === '') {
    // Not a v2 workbook - return null so legacy parser can handle it
    return null;
  } else if (templateVersion !== WORKFLOW_TEMPLATE_VERSION) {
    throw new Error(
      `Unsupported workbook template version: ${templateVersion}; download the current template`,
    );
  } else if (!['1', '2', '3', '4', '5', '6', WORKFLOW_MAPPING_VERSION].includes(mappingVersion)) {
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
  ignored['Reference Lists'] = [16];
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
              'VLOOKUP', 'LEN', 'LEFT', 'RIGHT', 'TEXT', 'ISNUMBER', 'VALUE', 'SUBSTITUTE', 'TRIM', 'MID', 'ROW',
            ].includes(f),
        )
      )
        throw new Error('Unsafe or external calculated formula');
      return '';
    },
    ['Address Lists', 'Postal Codes'],
  );
  const issues: WorkflowReviewIssue[] = [];
  const locations = new Map<Record<string,string>, WorkflowSource>();
  const owners = new Map<WorkbookCustomerV2, WorkflowSource[]>();
  let active: Record<string,string> = {};
  const problem = (field: string, message: string, fields = active) => {
    if(!options.collectErrors) throw new Error(message);
    const source=locations.get(fields)!;
    issues.push({sheet:source.sheet,row:source.row,field,column:Math.max(1,columnsBySheet[source.sheet].findIndex(c=>c.key===field)+1),message});
  };
  const attempt = (field: string, fn:()=>void) => { try{fn()}catch(error){problem(field,error instanceof Error?error.message:'Invalid value')} };
    const rowsBySheet = new Map<WorkflowSheet, Record<string, string>[]>();
  for (const sheet of sheets) {
    const matrix = matrices.get(sheet)!;
    const columns = columnsBySheet[sheet];
    const reviewTail = property('AFHomesReviewWorkbook')==='1' && matrix[0]?.length===columns.length+3 && WORKFLOW_REVIEW_HEADERS.every((h,i)=>matrix[0]![columns.length+i]===h);
    if ((!reviewTail && matrix[0]?.length !== columns.length) || columns.some((c, i) => matrix[0]![i] !== c.header))
      throw new Error(`${sheet}: incorrect or unmapped required headers`);
    const rows: Record<string, string>[] = [];
    for (const [index, values] of matrix.slice(1).entries()) {
      if (values.length > columns.length && values.slice(columns.length + (reviewTail ? 3 : 0)).some((v) => v.trim()))
        throw new Error(`${sheet} row ${index + 2}: unmapped column contains data`);
      const fields = Object.fromEntries(columns.map((c, i) => [c.key, (values[i] ?? '').trim()]));
      if (!columns.some((c) => c.disposition !== 'calculated' && fields[c.key])) continue;
      locations.set(fields,{sheet,row:index+2,fields:{...fields}}); active=fields;
      for(const c of columns) if(c.key.startsWith('review_')||c.key==='vip_id_preview') fields[c.key]='';
      if (['5', '6', '7'].includes(mappingVersion) && sheet === 'Customers') {
        const vip = fields.purchase_reference?.toUpperCase() ?? '';
        if (vip && !/^[0-9]{11}[BGS]1[CT][0-9]{2}[SN]$/.test(vip))
          problem('purchase_reference','VIP card ID: use the official 17-character format or leave blank to generate');
        fields.existing_vip_control_number = vip;
        fields.purchase_reference = vip || 'AUTO-VIP-' + createHash('sha256').update(JSON.stringify(['email','first_name','last_name','contract_date','vip_tier','stated_payment_scheme'].map(k => key(k === 'contract_date' && fields[k] ? workbookDate(fields[k]!, date1904) : fields[k] ?? '')))).digest('hex');
      }
      if (mappingVersion !== '1' && sheet === 'Customers')
        fields.customer_key = fields.purchase_reference ?? '';
      if (!fields.customer_key) { problem('customer_key', 'Select a customer link (VIP card ID, Customer ID, or unique email).'); fields.customer_key = 'INVALID-ROW-'+sheet+'-'+index; }
      rows.push(fields);
    }
    rowsBySheet.set(sheet, rows);
  }
  const result = new Map<string, WorkbookCustomerV2>();
  const purchases = new Set<string>();
  for (const fields of rowsBySheet.get('Customers')!) {
    active=fields;
    const customerKey = fields.customer_key!;
    if (fields.existing_vip_control_number && /^[0-9]{11}[BGS]1[CT][0-9]{2}[SN]$/.test(fields.purchase_reference ?? '') && fields.existing_vip_control_number.toUpperCase() !== fields.purchase_reference) problem('purchase_reference','Purchase reference must equal the VIP card ID');
    fields.ra_number = fields.customer_id ?? '';
    if (fields.ra_number.startsWith('AF-CUS-')) fields.customer_number = fields.ra_number;
    if (result.has(key(customerKey))) { problem('purchase_reference', 'Duplicate customer key: review both purchase rows.'); const previous=owners.get(result.get(key(customerKey))!)?.[0]; if(previous) problem('purchase_reference','Duplicate customer/purchase identity. Review both rows.',[...locations.keys()].find(f=>locations.get(f)===previous)!); }
    if (!fields.purchase_reference)
      throw new Error(`Customers ${customerKey}: Purchase reference is required`);
    if (purchases.has(key(fields.purchase_reference)))
      problem('purchase_reference', 'Duplicate purchase reference: VIP card ID must be unique');
    purchases.add(key(fields.purchase_reference));
    attempt('birth_date',()=>dateInput(fields, 'birth_date', 'birth', date1904));
    if (fields.contract_date) {
      fields.contract_date = workbookDate(fields.contract_date, date1904);
      if (fields.contract_date === 'INVALID DATE')
        problem('contract_date', 'Contract date: use a real date');
    }
    const tier = fields.vip_tier?.toUpperCase() ?? '';
    if (tier && !['GOLD', 'SILVER', 'BRONZE'].includes(tier))
      problem('vip_tier', 'VIP plan: choose Gold, Silver or Bronze');
    fields.vip_tier = tier;
    if (fields.stated_payment_scheme) {
      const aliases: Record<string, string> = {
        'move b1 (40% initial / 12 months)': 'Move b1 40 12',
        'move b2 (25% initial / 12 months)': 'Move b2 25 12',
        '4-month installment': 'Installment 4_month',
      };
      const value = aliases[key(fields.stated_payment_scheme)] ?? fields.stated_payment_scheme;
      const option = Object.keys(WORKBOOK_PAYMENT_SCHEMES).find((s) => key(s) === key(value));
      if (!option) problem('stated_payment_scheme', 'Payment terms: choose a listed payment scheme');
      fields.stated_payment_scheme = option ?? value;
    }
    for (const name of ['stated_regular_price', 'stated_discount', 'stated_rf'])
      if (fields[name]) attempt(name,()=>{fields[name] = money(fields[name]!, name)});
    if (fields.stated_regular_price && ['stated_regular_price','stated_discount','stated_rf'].every(k=>!fields[k]||/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(fields[k]!))) {
      const discount = fields.stated_discount || '0.00';
      if (compareMoney(discount, fields.stated_regular_price) > 0) {
        problem('stated_discount', 'Discount cannot exceed contract price'); fields.stated_total='';
      } else {
        fields.stated_total = subtractMoney(fields.stated_regular_price, discount);
        if (fields.stated_rf && compareMoney(fields.stated_rf, fields.stated_total) > 0)
          problem('stated_rf', 'Included reservation fee cannot exceed contract total');
      }
    } else fields.stated_total = '';
    // New VIP control / historical fields (mapping version 4)
    if (fields.existing_vip_control_number) {
      const vip = fields.existing_vip_control_number.trim().toUpperCase();
      if (!/^[0-9]{11}[BGS]1[CT][0-9]{2}[SN]$/.test(vip))
        problem('purchase_reference', 'Existing VIP control/card number: use the official 17-character VIP card ID, for example 26101400003G1C01S');
      fields.existing_vip_control_number = vip;
    }
    if (fields.existing_card_activation_status) {
      const status = fields.existing_card_activation_status.trim();
      const allowed = ['Active', 'Inactive', 'Expired', 'Suspended', 'Cancelled', 'Pending Activation'];
      if (!allowed.includes(status))
        problem('existing_card_activation_status', 'Existing card activation status: choose Active, Inactive, Expired, Suspended, Cancelled, or Pending Activation');
      fields.existing_card_activation_status = status;
    }
    if (fields.existing_stay_points_total) {
      const pts = fields.existing_stay_points_total.trim();
      if (!/^(0|[1-9]\d*)$/.test(pts) || Number(pts) > 1_000_000_000)
        problem('existing_stay_points_total', 'Existing Stay Points total: must be a whole non-negative number');
      fields.existing_stay_points_total = pts;
    }
    if (fields.existing_card_activation_date) {
      fields.existing_card_activation_date = workbookDate(fields.existing_card_activation_date, date1904);
      if (fields.existing_card_activation_date === 'INVALID DATE')
        problem('existing_card_activation_date', 'Existing card activation date: use a real date');
    }
    if (fields.existing_card_valid_until) {
      fields.existing_card_valid_until = workbookDate(fields.existing_card_valid_until, date1904);
      if (fields.existing_card_valid_until === 'INVALID DATE')
        problem('existing_card_valid_until', 'Existing card valid until: use a real date');
    }
    if (fields.vip_purchase_date) {
      fields.vip_purchase_date = workbookDate(fields.vip_purchase_date, date1904);
      if (fields.vip_purchase_date === 'INVALID DATE')
        problem('vip_purchase_date', 'VIP purchase date: use a real date');
    }
    if (fields.contract_classification) {
      const cls = fields.contract_classification.trim();
      if (!['Standard', 'Non-Standard'].includes(cls))
        problem('contract_classification', 'Contract classification: choose Standard or Non-Standard');
      fields.contract_classification = cls;
      if (fields.existing_vip_control_number && fields.existing_vip_control_number.endsWith('N') !== (cls === 'Non-Standard'))
        problem('contract_classification', 'Contract classification must match the VIP card ID suffix: S = Standard, N = Non-Standard');
    }
    if (fields.payment_term_months) {
      const rawMonths = fields.payment_term_months.trim();
      const months = Number(rawMonths);
      if (!/^\d+$/.test(rawMonths) || !Number.isInteger(months) || months < 1 || months > 36)
        problem('payment_term_months', 'Payment term months for VIP ID: must be an integer between 1 and 36');
      fields.payment_term_months = String(months);
    }
    if (mappingVersion === '7' && /^[0-9]{11}[BGS]1[CT][0-9]{2}[SN]$/.test(fields.existing_vip_control_number??'')) {
      const id=fields.existing_vip_control_number!;
      const tierCode=({GOLD:'G1',SILVER:'S1',BRONZE:'B1'} as Record<string,string>)[fields.vip_tier??''];
      const terms=({'Spot cash':'C01','Move a':'C01','Installment 4_month':'T04','Move b1 40 12':'T12','Move b2 25 12':'T12'} as Record<string,string>)[fields.stated_payment_scheme??''];
      if(tierCode&&id.slice(11,13)!==tierCode)problem('vip_tier','VIP tier does not match the existing VIP card ID.');
      if(terms&&id.slice(13,16)!==terms)problem('stated_payment_scheme','Payment scheme does not match the existing VIP card ID.');
    }
    if (mappingVersion === '7') {
      if (!fields.contract_classification) fields.contract_classification=fields.existing_vip_control_number?.endsWith('N')?'Non-Standard':'Standard';
      if (!fields.existing_vip_control_number && fields.contract_classification==='Non-Standard') problem('contract_classification','New non-standard IDs are not enabled. Use Standard or supply an authorized existing ID.');
    }
    fields.workbook_format = WORKFLOW_TEMPLATE_VERSION;
    fields.source_status = 'Pending';
    const record: WorkbookCustomerV2 = {
      customerKey,
      purchaseReference: fields.purchase_reference,
      customerId: fields.customer_id || null,
      fields,
      payments: [],
    };
    owners.set(record,[locations.get(fields)!]);
    result.set(result.has(key(customerKey))?key(customerKey)+'#'+locations.get(fields)!.row:key(customerKey),record);
  }
  const aliases = new Map<string, WorkbookCustomerV2 | null>();
  if (['5', '6', '7'].includes(mappingVersion)) for (const customer of result.values()) {
    for (const value of [customer.customerId, customer.fields.email]) {
      if (!value) continue;
      const alias = key(value);
      aliases.set(alias, aliases.has(alias) ? null : customer);
    }
  }
  for (const sheet of ['Supplementary Holders', 'Sales Team', 'Payments'] as const) {
    const seen = new Set<string>();
    for (const fields of rowsBySheet.get(sheet)!) {
      active=fields;
      const suppliedKey = key(fields.customer_key!);
      if (aliases.has(suppliedKey) && aliases.get(suppliedKey) === null && !result.has(suppliedKey)) {problem('customer_key','Ambiguous customer link; supply the VIP card ID or unique Customer ID.');continue;}
      const customer = result.get(suppliedKey) ?? aliases.get(suppliedKey);
      const id = customer ? key(customer.customerKey) : suppliedKey;
      if (!customer) { problem('customer_key', 'Unknown customer key. Select an existing VIP ID, Customer ID, or unique email from Customers.'); continue; }
      owners.get(customer)!.push(locations.get(fields)!);
      if (sheet === 'Payments') {
        attempt('date',()=>dateInput(fields, 'date', 'payment', date1904));
        let amount='0.00'; attempt('amount',()=>{amount=money(fields.amount ?? '', 'Payment amount')});
        if (compareMoney(amount, '0.00') <= 0) problem('amount','Payment amount must be positive');
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
          problem('payment_key','Duplicate payment claim. Give genuinely separate identical payments distinct claim references.');
        seen.add(source);
        const claim = workbookPaymentClaimSchema.safeParse({
          paymentKey,
          customerKey: customer.customerKey,
          purpose: purposes[key(fields.purpose ?? '')],
          amount,
          date: fields.date,
          method: methods[key(fields.method ?? '')],
          reference: fields.reference ?? '',
          notes: fields.notes ?? '',
        });
        if(claim.success) customer.payments.push(claim.data);
        else { if(!options.collectErrors) throw claim.error; for(const issue of claim.error.issues) problem(({paymentKey:'payment_key',customerKey:'customer_key'} as Record<string,string>)[String(issue.path[0])]??String(issue.path[0]),issue.message); }
      } else {
        if (seen.has(id)) problem('customer_key', 'More than one row links to this customer; consolidate this sheet record.');
        seen.add(id);
        if (sheet === 'Supplementary Holders') {
          if (customer.fields.vip_tier !== 'GOLD')
            problem('customer_key','Supplementary holder is Gold-only');
          attempt('birth_date',()=>dateInput(fields, 'birth_date', 'birth', date1904));
          for (const [field, value] of Object.entries(fields))
            if (field !== 'customer_key') customer.fields['secondary_' + field] = value;
        } else
          for (const [field, value] of Object.entries(fields))
            if (field !== 'customer_key') customer.fields[field] = value;
      }
    }
  }
  for (const customer of result.values()) {
    active=[...locations.keys()].find(f=>locations.get(f)===owners.get(customer)?.[0])!;
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
            problem(prefix+'postal_code','Postal code conflicts with the selected address');
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
      if (compareMoney(total, customer.fields.stated_total) > 0) {
        problem('stated_regular_price','Payment claims exceed contract total; reconcile before import');customer.fields.claimed_balance='';
      } else customer.fields.claimed_balance = subtractMoney(customer.fields.stated_total, total);
    } else customer.fields.claimed_balance = '';
  }
  return {
    rows: [...result.values()].map((r) => workbookCustomerV2Schema.parse(r)),
    unknownHeaders: [],
    issues,
    sources: [...result.values()].map(r=>owners.get(r)!),
  };
}
