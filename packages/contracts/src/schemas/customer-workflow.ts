import { z } from 'zod';
import { exactDecimalStringSchema } from './money.js';

export const WORKFLOW_TEMPLATE_VERSION = 'company_v2';
export const WORKFLOW_MAPPING_VERSION = '7';
export type WorkflowColumn = {
  key: string;
  header: string;
  disposition: 'input' | 'calculated' | 'helper';
  destinations: readonly string[];
};
const input = (key: string, header: string, ...destinations: string[]): WorkflowColumn => ({
  key,
  header,
  disposition: 'input',
  destinations,
});
const calculated = (key: string, header: string): WorkflowColumn => ({
  key,
  header,
  disposition: 'calculated',
  destinations: ['server.recomputedDisplay'],
});
const helper = (key: string, header: string): WorkflowColumn => ({
  key,
  header,
  disposition: 'helper',
  destinations: ['source.dateHelper'],
});
const holderColumns = (secondary: boolean): WorkflowColumn[] => {
  const holder = secondary ? 'secondary' : 'primary';
  const customer: Record<string, string> = secondary
    ? {
        first_name: 'company.supplementaryFullName',
        last_name: 'company.supplementaryFullName',
        middle_name: 'company.supplementaryFullName',
        suffix: 'company.supplementaryFullName',
        birth_date: 'company.supplementaryBirthday',
        sex: 'company.supplementaryGender',
        citizenship: 'company.supplementaryCitizenship',
        civil_status: 'company.supplementaryCivilStatus',
        address_line_1: 'company.supplementaryAddress',
        address_line_2: 'company.supplementaryAddress',
        province: 'company.supplementaryAddress',
        city: 'company.supplementaryAddress',
        barangay: 'company.supplementaryAddress',
        postal_code: 'company.supplementaryAddress',
        landline: 'company.supplementaryLandline',
        email: 'company.supplementaryEmail',
        mobile: 'company.supplementaryMobile',
        tin: 'company.supplementaryTinNumber',
        occupation: 'company.supplementaryOccupationBusinessName',
        business_address: 'company.supplementaryOfficeAddress',
        position: 'company.supplementaryPosition',
      }
    : {
        first_name: 'person.firstName',
        last_name: 'person.lastName',
        middle_name: 'person.middleName',
        suffix: 'person.suffix',
        birth_date: 'person.birthDate',
        sex: 'person.gender',
        citizenship: 'company.citizenship',
        civil_status: 'company.civilStatus',
        address_line_1: 'person.address.line1',
        address_line_2: 'person.address.line2',
        province: 'person.address.province',
        city: 'person.address.city',
        barangay: 'person.address.barangay',
        postal_code: 'person.address.postalCode',
        landline: 'person.landline',
        email: 'person.email',
        mobile: 'person.phone',
        tin: 'company.tinNumber',
        occupation: 'company.occupationBusinessName',
        business_address: 'company.officeBusinessAddress',
        position: 'company.employedPosition',
      };
  const fields = [
    ['first_name', 'First name', 'firstName'],
    ['last_name', 'Last name', 'lastName'],
    ['middle_name', 'Middle name', 'middleName'],
    ['suffix', 'Suffix', 'suffix'],
    ['birth_date', 'Birth date', 'birthDate'],
    ['sex', 'Gender', 'sex'],
    ['citizenship', 'Citizenship', 'citizenship'],
    ['civil_status', 'Civil status', 'civilStatus'],
    ['address_line_1', 'Address line 1', 'permanentAddressLine1'],
    ['address_line_2', 'Address line 2', 'permanentAddressLine2'],
    ['province', 'Province', 'province'],
    ['city', 'City / Municipality', 'cityMunicipality'],
    ['barangay', 'Barangay', 'barangay'],
    ['postal_code', 'Postal code', 'postalCode'],
    ['landline', 'Landline', 'landline'],
    ['email', 'Email', 'email'],
    ['mobile', 'Mobile number', 'mobile'],
    ['tin', 'TIN (optional)', 'tinNumber'],
    ['occupation', 'Occupation / Business name', 'occupationBusinessName'],
    ['business_address', 'Office / Business address', 'officeBusinessAddress'],
    ['position', 'Position', 'employedPosition'],
  ];
  return fields
    .map(([key, header, property]) =>
      input(key!, header!, customer[key!]!, `application.${holder}.${property}`),
    )
    .concat([
      calculated('age', 'Age (calculated)'),
      helper('birth_day', 'Birth day'),
      helper('birth_month', 'Birth month'),
      helper('birth_year', 'Birth year'),
    ]);
};
const customerKey = () => input('customer_key', 'Customer key', 'source.customerKey');

/** One manifest owns parser headers, export headers and complete mapping coverage. */
export const LEGACY_WORKFLOW_COLUMNS = {
  Customers: [
    customerKey(),
    input('customer_id', 'Customer ID (RA No.)', 'identity.customerReference'),
    input('purchase_reference', 'Purchase reference', 'source.purchaseReference'),
    input(
      'existing_reservation_reference',
      'Existing reservation reference',
      'source.reservationCandidate',
    ),
    input('stated_status', 'Existing document status (optional)', 'company.companyStatus'),
    ...holderColumns(false),
    input('vip_tier', 'VIP plan', 'company.statedVipPackage', 'application.tier'),
    input(
      'stated_payment_scheme',
      'Payment terms',
      'company.statedPaymentTerms',
      'application.paymentScheme',
    ),
    input('contract_date', 'Contract date', 'source.contractDate'),
    input('stated_regular_price', 'Regular contract price', 'company.statedRegularPrice'),
    input('stated_discount', 'Approved discount amount (claimed)', 'company.statedDiscount'),
    calculated('stated_total', 'Contract total (calculated)'),
    input('stated_rf', 'Included reservation fee', 'company.statedRf'),
    calculated('claimed_payment_total', 'Payments stated (calculated)'),
    calculated('claimed_balance', 'Remaining balance (calculated)'),

  ],
  'Supplementary Holders': [customerKey(), ...holderColumns(true)],
  'Sales Team': [
    customerKey(),
    input('vd_name', 'VD / SVD (workbook claim)', 'company.svdName', 'application.svdStaffId'),
    input('ssm_name', 'SSM (workbook claim)', 'company.ssmName', 'application.ssmStaffId'),
    input('sm_name', 'SM (workbook claim)', 'company.smName', 'application.smStaffId'),
    input(
      'referrer_name',
      'Referrer',
      'customer.referred_by_staff_id',
      'application.referrerStaffId',
    ),
    input(
      'recommender_name',
      'VIP Recommender',
      'company.vipRecommenderName',
      'source.recommenderStaffId',
    ),
    input(
      'recommender_contact',
      'Recommender contact',
      'company.relatedContactNo',
      'application.recommenderContact',
    ),
    input(
      'recommender_email',
      'Recommender email',
      'company.relatedEmail',
      'application.recommenderEmail',
    ),
    ...['Referrer', 'Recommender'].flatMap((name) =>
      ['VD', 'SSM', 'SM'].map((role) =>
        calculated(`${name.toLowerCase()}_${role.toLowerCase()}`, `${name} ${role}`),
      ),
    ),
  ],
  Payments: [
    customerKey(),
    input('payment_key', 'Payment claim reference', 'claim.sourceReference'),
    input('purpose', 'Purpose', 'claim.purpose'),
    input('amount', 'Amount paid (claimed)', 'claim.amount'),
    input('date', 'Payment date', 'claim.date'),
    input('method', 'Payment method', 'claim.method'),
    input('reference', 'Receipt / Bank reference', 'claim.reference'),
    input('notes', 'Notes', 'claim.notes'),
    helper('payment_day', 'Payment day'),
    helper('payment_month', 'Payment month'),
    helper('payment_year', 'Payment year'),
  ],
} satisfies Record<string, WorkflowColumn[]>;
/** Mapping 1 remains readable; new downloads ask for each fact only once. */
export const PREVIOUS_WORKFLOW_COLUMNS = Object.fromEntries(
  Object.entries(LEGACY_WORKFLOW_COLUMNS).map(([sheet, columns]) => [
    sheet,
    columns
      .filter(
        (c) =>
          c.disposition !== 'helper' &&
          c.key !== 'age' &&
          !(sheet === 'Customers' && c.key === 'customer_key'),
      )
      .flatMap((c) => (c.key === 'birth_date' ? [c, calculated('age', 'Age (calculated)')] : [c]))
      .map((c) => ({
        ...c,
        disposition: ['recommender_contact', 'recommender_email'].includes(c.key)
          ? ('calculated' as const)
          : c.disposition,
        header:
          c.key === 'customer_key'
            ? 'Purchase reference (select customer)'
            : c.key === 'payment_key'
              ? 'Payment claim reference (optional)'
              : c.key === 'landline'
                ? 'Landline (optional)'
                : c.key === 'stated_status'
                  ? 'Existing document status (optional)'
                  : c.header,
      })),
  ]),
) as typeof LEGACY_WORKFLOW_COLUMNS;
export const WORKFLOW_V3_COLUMNS = {
  ...PREVIOUS_WORKFLOW_COLUMNS,
  'Supplementary Holders': PREVIOUS_WORKFLOW_COLUMNS['Supplementary Holders'].map((column) =>
    column.key === 'customer_key'
      ? { ...column, header: 'Gold purchase reference (select)' }
      : column,
  ),
  'Sales Team': PREVIOUS_WORKFLOW_COLUMNS['Sales Team'].filter(
    (column) =>
      ![
        'referrer_vd',
        'referrer_ssm',
        'referrer_sm',
        'recommender_vd',
        'recommender_ssm',
        'recommender_sm',
      ].includes(column.key),
  ),
};
export const WORKFLOW_V4_COLUMNS = {
  ...WORKFLOW_V3_COLUMNS,
  Customers: [...WORKFLOW_V3_COLUMNS.Customers,
    input(
      'existing_vip_control_number',
      'Existing VIP control/card number (optional; generate on import if blank)',
      'company.existingVipControlNumber',
      'sale.vipControlNumber',
    ),
    input('existing_card_activation_status', 'Existing card activation status', 'company.existingCardActivationStatus'),
    input('existing_stay_points_total', 'Existing Stay Points total', 'company.existingStayPointsTotal'),
    input('existing_card_activation_date', 'Existing card activation date', 'company.existingCardActivationDate'),
    input('existing_card_valid_until', 'Existing card valid until', 'company.existingCardValidUntil'),
    input('vip_purchase_date', 'VIP purchase date (if known)', 'source.vipPurchaseDate'),
    input(
      'contract_classification',
      'Contract classification (Standard / Non-Standard)',
      'company.contractClassification',
    ),
    input(
      'payment_term_months',
      'Payment term months for VIP ID (1-36; optional)',
      'company.paymentTermMonths',
    ),
  ],
};
export const WORKFLOW_V5_COLUMNS = {
  ...WORKFLOW_V4_COLUMNS,
  Customers: WORKFLOW_V4_COLUMNS.Customers.filter(c => !['existing_vip_control_number', 'contract_classification'].includes(c.key)).map(c =>
    c.key === 'purchase_reference' ? { ...c, header: 'VIP card ID / Purchase reference (blank generates)' } : c),
};
export const WORKFLOW_V6_COLUMNS = {
  ...WORKFLOW_V5_COLUMNS,
  Customers: [...WORKFLOW_V5_COLUMNS.Customers, { ...WORKFLOW_V4_COLUMNS.Customers.find(c => c.key === 'contract_classification')!, header: 'Contract type (new IDs: Standard)' }],
};
export const WORKFLOW_TEMPLATE_ROWS = 500;
export const WORKFLOW_REVIEW_HEADERS = ['Review status', 'Errors to correct', 'Warnings to review'] as const;
const reviewColumns = WORKFLOW_REVIEW_HEADERS.map((header, i) => calculated(['review_status','review_errors','review_warnings'][i]!, header));
const mainOrder = ['customer_id','purchase_reference','first_name','last_name','middle_name','suffix','birth_date','mobile','email','address_line_1','province','city','barangay','vip_tier','stated_payment_scheme','stated_status','contract_date','stated_regular_price','stated_discount','stated_rf','existing_card_activation_status','existing_stay_points_total','existing_card_activation_date','existing_card_valid_until'];
const simpleHeaders: Record<string,string> = {customer_id:'Customer ID (blank generates)',purchase_reference:'VIP card ID (blank generates)',vip_tier:'VIP tier',stated_payment_scheme:'Payment scheme',stated_status:'Purchase status',contract_date:'Contract date',stated_regular_price:'Agreed contract price',stated_discount:'Approved discount amount',stated_rf:'Included reservation fee',existing_stay_points_total:'Existing usable Loyalty Stay Points',contract_classification:'Contract classification (blank = Standard)',vip_purchase_date:'Purchase date (if different from contract date)',customer_key:'Customer link (select)',vd_name:'SVD (select registered account)',ssm_name:'SSM (select registered account)',sm_name:'SM (select registered account)'};
const simple = (columns: WorkflowColumn[]) => columns.map(c=>({...c,header:simpleHeaders[c.key]??c.header}));
export const WORKFLOW_COLUMNS = {
  Customers: [...simple(WORKFLOW_V6_COLUMNS.Customers.filter(c=>!['age','stated_total','claimed_payment_total','claimed_balance','payment_term_months'].includes(c.key))).sort((a,b)=>(mainOrder.includes(a.key)?mainOrder.indexOf(a.key):100)-(mainOrder.includes(b.key)?mainOrder.indexOf(b.key):100)).flatMap(c=>c.key==='purchase_reference'?[c,calculated('vip_id_preview', 'Proposed VIP ID (editable comparison)')]:[c]),...reviewColumns],
  'Supplementary Holders': [...simple(WORKFLOW_V6_COLUMNS['Supplementary Holders'].filter(c=>c.key!=='age')),...reviewColumns],
  'Sales Team': [...simple(WORKFLOW_V6_COLUMNS['Sales Team'].filter(c=>!['recommender_contact','recommender_email'].includes(c.key))),...reviewColumns],
  Payments: [...simple(WORKFLOW_V6_COLUMNS.Payments),...reviewColumns],
};
export type WorkflowSheet = keyof typeof WORKFLOW_COLUMNS;

const text = z.string().trim().max(200);
export const workbookPaymentClaimSchema = z.strictObject({
  paymentKey: text.min(1),
  customerKey: text.min(1),
  purpose: z.enum(['reservation', 'down_payment', 'installment', 'full']),
  amount: exactDecimalStringSchema,
  date: z.iso.date(),
  method: z.enum(['cash', 'bank_transfer', 'gcash', 'maya', 'card', 'cheque']),
  reference: text,
  notes: z.string().max(1000).default(''),
});
export type WorkbookPaymentClaim = z.infer<typeof workbookPaymentClaimSchema>;
export const workbookCustomerV2Schema = z.strictObject({
  customerKey: text.min(1),
  purchaseReference: text.min(1),
  customerId: text.nullable(),
  fields: z.record(z.string(), z.string()),
  payments: z.array(workbookPaymentClaimSchema).max(5000),
});
export type WorkbookCustomerV2 = z.infer<typeof workbookCustomerV2Schema>;
