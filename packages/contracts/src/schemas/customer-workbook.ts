import { z } from 'zod';
import { applicationHolderSchema, vipTierSchema } from './official-forms.js';
import { paymentSchemeSchema } from './lifecycle.js';
export const workbookContactSchema = z
  .string()
  .regex(/^\d{11}$/, 'Use exactly 11 digits, including the leading zero; no spaces or separators');

export const companyApplicationPrefillSchema = z.object({
  primary: applicationHolderSchema.partial(),
  secondary: applicationHolderSchema.partial().nullable(),
  tier: vipTierSchema.optional(),
  paymentScheme: paymentSchemeSchema.optional(),
  recommenderName: z.string(),
  recommenderContact: z.string(),
  recommenderEmail: z.string(),
  salesManagerName: z.string(),
  referrerName: z.string(),
  missingFields: z.array(z.string()),
});

/** Exact company workbook vocabulary; geographic reference tabs are never customer input. */
export const CUSTOMER_WORKBOOK_HEADERS = {
  Primary: [
    'RA NO',
    'STATUS',
    'FIRST NAME',
    'LAST NAME',
    'MIDDLE NAME',
    'SUFFIX',
    'BIRTHDAY',
    'GENDER',
    'AGE',
    'CITIZENSHIP',
    'CIVIL STATUS',
    'PERMANENT ADDRESS LINE 1',
    'PERMANENT ADDRESS LINE 2',
    'PROVINCE',
    'CITY',
    'BARANGGAY',
    'POSTAL CODE',
    'LANDLINE',
    'EMAIL',
    'TIN NO.',
    'MOBILE NO.',
    'OCCUPATION / BUSINESS NAME',
    'OFFICE / BUSINESS ADDRESS',
    'EMPLOYED POSITION',
  ],
  Supplementary: [
    'FIRST NAME',
    'LAST NAME',
    'MIDDLE NAME',
    'SUFFIX',
    'BIRTHDAY',
    'GENDER',
    'AGE',
    'CITIZENSHIP',
    'CIVIL STATUS',
    'PERMANENT ADDRESS LINE 1',
    'PERMANENT ADDRESS LINE 2',
    'PROVINCE',
    'CITY',
    'BARANGGAY',
    'POSTAL CODE',
    'LANDLINE',
    'EMAIL',
    'TIN NO.',
    'MOBILE NO.',
    'OCCUPATION / BUSINESS NAME',
    'OFFICE / BUSINESS ADDRESS',
    'EMPLOYED POSITION',
  ],
  Related: [
    'SVD (NAME)',
    'SSM (NAME)',
    'SM (NAME)',
    'REFERRER (NAME)',
    'VIP RECOMMENDER (NAME)',
    'CONTACT NO.',
    'EMAIL ADDRESS',
  ],
  Package: [
    'VIP PACKAGE',
    'PAYMENT TERMS',
    'REGULAR PRICE',
    'DISCOUNT',
    'TOTAL AMOUNT',
    'RF',
    'PAYMENT TYPE',
    'REF NO',
    'DATE',
  ],
} as const;
export type CustomerWorkbookSheet = keyof typeof CUSTOMER_WORKBOOK_HEADERS;
export const CUSTOMER_WORKBOOK_SHEETS = Object.keys(
  CUSTOMER_WORKBOOK_HEADERS,
) as CustomerWorkbookSheet[];
export const CUSTOMER_WORKBOOK_CHOICES = {
  status: [
    'Active VIP',
    'Fully Paid',
    'Down Payment',
    'Reservation Paid',
    'Partially Paid',
    'Pending',
    'Inactive',
    'Suspended',
    'Expired',
    'Cancelled',
  ],
  suffix: ['Jr.', 'Sr.', 'II', 'III', 'IV', 'N/A'],
  gender: ['Male', 'Female'],
  civil_status: ['Single', 'Married', 'Widowed', 'Separated'],
  vip_tier: ['GOLD', 'SILVER', 'BRONZE'],
  stated_payment_scheme: [
    'Spot cash',
    'Move a',
    'Installment 4_month',
    'Move b1 40 12',
    'Move b2 25 12',
  ],
  stated_payment_method: ['Cash', 'Bank transfer', 'Gcash', 'Maya', 'Card', 'Cheque'],
} as const;
export const WORKBOOK_PAYMENT_SCHEMES: Record<string, string> = {
  'Spot cash': 'spot_cash',
  'Move a': 'move_a',
  'Installment 4_month': 'installment_4_month',
  'Move b1 40 12': 'move_b1_40_12',
  'Move b2 25 12': 'move_b2_25_12',
};
export const WORKBOOK_PAYMENT_METHODS: Record<string, string> = {
  Cash: 'cash',
  'Bank transfer': 'bank_transfer',
  Gcash: 'gcash',
  Maya: 'maya',
  Card: 'card',
  Cheque: 'cheque',
};
/** Re-case uniform input only; preserve intentional mixed-case spelling and suffixes. */
export function normalizeWorkbookName(value: string): string {
  return value
    .trim()
    .split(/(\s+|[-â€™'])/u)
    .map((word) => {
      if (['II', 'III', 'IV'].includes(word)) return word;
      if (word !== word.toUpperCase() && word !== word.toLowerCase()) return word;
      return word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase();
    })
    .join('');
}
export function completedAge(birthDate: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return years - (today.slice(5) < birthDate.slice(5) ? 1 : 0);
}

const HOLDER_FIELDS = [
  'first_name',
  'last_name',
  'middle_name',
  'suffix',
  'birth_date',
  'sex',
  'age',
  'citizenship',
  'civil_status',
  'address_line_1',
  'address_line_2',
  'province',
  'city',
  'barangay',
  'postal_code',
  'landline',
  'email',
  'tin',
  'mobile',
  'occupation',
  'business_address',
  'position',
];
export const CUSTOMER_WORKBOOK_FIELDS: Record<string, string[]> = {
  Primary: ['ra_number', 'stated_status', ...HOLDER_FIELDS],
  Supplementary: HOLDER_FIELDS.map((f) => 'secondary_' + f),
  Related: [
    'vd_name',
    'ssm_name',
    'sm_name',
    'referrer_name',
    'recommender_name',
    'recommender_contact',
    'recommender_email',
  ],
  Package: [
    'vip_tier',
    'stated_payment_scheme',
    'stated_regular_price',
    'stated_discount',
    'stated_total',
    'stated_rf',
    'stated_payment_method',
    'stated_reference',
    'stated_date',
  ],
};
