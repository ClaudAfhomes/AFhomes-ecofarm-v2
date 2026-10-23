/**
 * Customer-record SSOT: the company's master field list for customer records.
 *
 * This file is the SINGLE SOURCE for the guided membership template (both the
 * sectioned XLSX and the flat CSV), the positional import remap, and the
 * staff customer export. Every header lives here exactly once, in the order
 * the company stated it, with its import key and storage target. If a header
 * appears in a download but not here (or the reverse), a coverage spec fails.
 *
 * Block layout (62 columns):
 *   Primary 24, Supplementary 22, OST/IST 7, VIP Package 9.
 *
 * Rules carried from the business record design:
 * - Names split by the OPERATOR into FIRST/LAST/MIDDLE/SUFFIX columns; the
 *   code never splits a stored FULL NAME.
 * - Supplementary names and the supplementary address are JOINED per row into
 *   the single stored text columns (`supplementary_full_name` /
 *   `supplementary_address`) - never derived from FULL NAME, never stored as
 *   parts.
 * - AGE is reference-only: derived from the birthday at display time, never
 *   stored, warned and ignored on import.
 * - TIN columns are write-only on import and list reads; the single-record
 *   detail read returns the raw value for authorized staff, never for audits.
 * - Stated package/payment figures are verbatim; they never feed totals.
 * - Dropdown values come only from the application form's pick-lists and the
 *   import validator's vocabularies. Nothing here invents a value set.
 */
import {
  CIVIL_STATUS_OPTIONS,
  CITIZENSHIP_OPTIONS,
  SEX_OPTIONS,
  SUFFIX_OPTIONS,
} from './official-forms.js';
import { PAYMENT_SCHEMES } from './lifecycle.js';

/**
 * Friendly statuses the guided workbook offers. Every value round-trips
 * through `mapSourceStatus` (asserted in the spec), so a dropdown choice can
 * never be "Unknown status" at validation time.
 */
export const TEMPLATE_STATUS_OPTIONS = [
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
] as const;

/** Payment methods the payments UI already offers; stored verbatim. */
export const TEMPLATE_PAYMENT_METHOD_OPTIONS = [
  'cash',
  'bank_transfer',
  'gcash',
  'maya',
  'card',
  'cheque',
] as const;

export const TEMPLATE_TIER_OPTIONS = ['GOLD', 'SILVER', 'BRONZE'] as const;

/**
 * One column of the guided workbook. A column either maps to an import key
 * (`target`), joins into one import key with its sibling part columns
 * (`join` - supplementary names and the supplementary address, stored as the
 * one text column the record actually has), or is reference-only
 * (`target: null`, warned and never merged, e.g. the derived AGE).
 */
export type CustomerSsotColumn = {
  /** Printed header, verbatim as the company stated it. */
  header: string;
  /** Import key; null marks a reference-only column; omitted for joins. */
  target?: string | null;
  /** Dropdown values rendered into the XLSX download (CSV carries none). */
  values?: readonly string[];
  /** Fold this part into one import key together with its sibling parts. */
  join?: { key: string; separator: string };
  /** Storage target (column or jsonb path) - documentation + coverage test. */
  dbColumn?: string;
  /** Sensitivity marker: `write-only` = masked on every read. */
  sensitivity?: 'write-only';
};

export type CustomerSsotSection = {
  sheet: string;
  tone: 'blue' | 'green' | 'amber' | 'purple';
  blurb: string;
  columns: readonly CustomerSsotColumn[];
};

/**
 * The guided workbook mirrors the customer-application form and the
 * company's stated master list: split names, split address, and fixed-value
 * dropdowns wherever the form has a closed pick-list. Targets are the SAME
 * import keys the 44-column company layout already writes, so both layouts
 * land on one pipeline. PSGC-verified province/city/barangay dropdowns are
 * not reproducible in a spreadsheet, so the address parts are plain text;
 * nothing here invents a geographic code.
 */
export const CUSTOMER_SSOT_SECTIONS: readonly CustomerSsotSection[] = [
  {
    sheet: 'Primary',
    tone: 'blue',
    blurb: 'Primary member: names, birth, contact, address and work.',
    columns: [
      { header: 'RA NO', target: 'ra_number', dbColumn: 'customers.ra_number' },
      { header: 'STATUS', target: 'source_status', values: TEMPLATE_STATUS_OPTIONS, dbColumn: 'customers.company_status' },
      { header: 'FIRST NAME', target: 'first_name', dbColumn: 'customers.first_name' },
      { header: 'LAST NAME', target: 'last_name', dbColumn: 'customers.last_name' },
      { header: 'MIDDLE NAME', target: 'middle_name', dbColumn: 'customers.middle_name' },
      { header: 'SUFFIX', target: 'suffix', values: SUFFIX_OPTIONS, dbColumn: 'customers.suffix' },
      { header: 'BIRTHDAY', target: 'birth_date', dbColumn: 'customers.birth_date' },
      { header: 'GENDER', target: 'sex', values: SEX_OPTIONS, dbColumn: 'customers.gender' },
      // Reference-only: derived from the birthday, never stored.
      { header: 'AGE', target: null },
      { header: 'CITIZENSHIP', target: 'citizenship', values: CITIZENSHIP_OPTIONS, dbColumn: 'customers.citizenship' },
      { header: 'CIVIL STATUS', target: 'civil_status', values: CIVIL_STATUS_OPTIONS, dbColumn: 'customers.civil_status' },
      { header: 'PERMANENT ADDRESS LINE 1', target: 'address_line_1', dbColumn: 'customers.address.line1' },
      { header: 'PERMANENT ADDRESS LINE 2', target: 'address_line_2', dbColumn: 'customers.address.line2' },
      { header: 'PROVINCE', target: 'province', dbColumn: 'customers.address.province' },
      { header: 'CITY', target: 'city', dbColumn: 'customers.address.city' },
      { header: 'BARANGGAY', target: 'barangay', dbColumn: 'customers.address.barangay' },
      { header: 'POSTAL CODE', target: 'postal_code', dbColumn: 'customers.address.postalCode' },
      { header: 'LANDLINE', target: 'landline', dbColumn: 'customers.landline' },
      { header: 'EMAIL', target: 'email', dbColumn: 'customers.email' },
      { header: 'TIN NO.', target: 'tin_number', sensitivity: 'write-only', dbColumn: 'customers.tin_number' },
      { header: 'MOBILE NO.', target: 'mobile', dbColumn: 'customers.phone' },
      { header: 'OCCUPATION / BUSINESS NAME', target: 'occupation_business_name', dbColumn: 'customers.occupation_business_name' },
      { header: 'OFFICE / BUSINESS ADDRESS', target: 'office_business_address', dbColumn: 'customers.office_business_address' },
      { header: 'EMPLOYED POSITION', target: 'employed_position', dbColumn: 'customers.employed_position' },
    ],
  },
  {
    sheet: 'Supplementary',
    tone: 'green',
    blurb: 'Second cardholder. Leave blank when none.',
    columns: [
      { header: 'FIRST NAME', join: { key: 'supplementary_full_name', separator: ' ' }, dbColumn: 'customers.supplementary_full_name' },
      { header: 'LAST NAME', join: { key: 'supplementary_full_name', separator: ' ' }, dbColumn: 'customers.supplementary_full_name' },
      { header: 'MIDDLE NAME', join: { key: 'supplementary_full_name', separator: ' ' }, dbColumn: 'customers.supplementary_full_name' },
      { header: 'SUFFIX', join: { key: 'supplementary_full_name', separator: ' ' }, dbColumn: 'customers.supplementary_full_name' },
      { header: 'BIRTHDAY', target: 'supplementary_birthday', dbColumn: 'customers.supplementary_birthday' },
      { header: 'GENDER', target: 'supplementary_gender', values: SEX_OPTIONS, dbColumn: 'customers.supplementary_gender' },
      { header: 'AGE', target: null },
      { header: 'CITIZENSHIP', target: 'supplementary_citizenship', values: CITIZENSHIP_OPTIONS, dbColumn: 'customers.supplementary_citizenship' },
      { header: 'CIVIL STATUS', target: 'supplementary_civil_status', values: CIVIL_STATUS_OPTIONS, dbColumn: 'customers.supplementary_civil_status' },
      { header: 'PERMANENT ADDRESS LINE 1', join: { key: 'supplementary_address', separator: ', ' }, dbColumn: 'customers.supplementary_address' },
      { header: 'PERMANENT ADDRESS LINE 2', join: { key: 'supplementary_address', separator: ', ' }, dbColumn: 'customers.supplementary_address' },
      { header: 'PROVINCE', join: { key: 'supplementary_address', separator: ', ' }, dbColumn: 'customers.supplementary_address' },
      { header: 'CITY', join: { key: 'supplementary_address', separator: ', ' }, dbColumn: 'customers.supplementary_address' },
      { header: 'BARANGGAY', join: { key: 'supplementary_address', separator: ', ' }, dbColumn: 'customers.supplementary_address' },
      { header: 'POSTAL CODE', join: { key: 'supplementary_address', separator: ', ' }, dbColumn: 'customers.supplementary_address' },
      { header: 'LANDLINE', target: 'supplementary_landline', dbColumn: 'customers.supplementary_landline' },
      { header: 'EMAIL', target: 'supplementary_email', dbColumn: 'customers.supplementary_email' },
      { header: 'TIN NO.', target: 'supplementary_tin_number', sensitivity: 'write-only', dbColumn: 'customers.supplementary_tin_number' },
      { header: 'MOBILE NO.', target: 'supplementary_mobile', dbColumn: 'customers.supplementary_mobile' },
      { header: 'OCCUPATION / BUSINESS NAME', target: 'supplementary_occupation_business_name', dbColumn: 'customers.supplementary_occupation_business_name' },
      { header: 'OFFICE / BUSINESS ADDRESS', target: 'supplementary_office_address', dbColumn: 'customers.supplementary_office_address' },
      { header: 'EMPLOYED POSITION', target: 'supplementary_position', dbColumn: 'customers.supplementary_position' },
    ],
  },
  {
    sheet: 'Related',
    tone: 'amber',
    blurb: 'Referral chain and related-person contact, stated verbatim.',
    columns: [
      { header: 'SVD (NAME)', target: 'svd_name', dbColumn: 'customers.svd_name' },
      { header: 'SSM (NAME)', target: 'ssm_name', dbColumn: 'customers.ssm_name' },
      { header: 'SM (NAME)', target: 'sm_name', dbColumn: 'customers.sm_name' },
      { header: 'REFERRER (NAME)', target: 'referrer_name', dbColumn: 'customers.referrer_name' },
      { header: 'VIP RECOMMENDER (NAME)', target: 'vip_recommender_name', dbColumn: 'customers.vip_recommender_name' },
      { header: 'CONTACT NO.', target: 'related_contact_no', dbColumn: 'customers.related_contact_no' },
      { header: 'EMAIL ADDRESS', target: 'related_email', dbColumn: 'customers.related_email' },
    ],
  },
  {
    sheet: 'Package',
    tone: 'purple',
    blurb: 'Stated package and payment facts. Reference only, never totals.',
    columns: [
      { header: 'VIP PACKAGE', target: 'vip_tier', values: TEMPLATE_TIER_OPTIONS, dbColumn: 'customers.stated_vip_package' },
      { header: 'PAYMENT TERMS', target: 'payment_scheme', values: PAYMENT_SCHEMES, dbColumn: 'customers.stated_payment_terms' },
      { header: 'REGULAR PRICE', target: 'stated_regular_price', dbColumn: 'customers.stated_regular_price' },
      { header: 'DISCOUNT', target: 'stated_discount', dbColumn: 'customers.stated_discount' },
      { header: 'TOTAL AMOUNT', target: 'stated_total_amount', dbColumn: 'customers.stated_total_amount' },
      { header: 'RF', target: 'stated_rf', dbColumn: 'customers.stated_rf' },
      { header: 'PAYMENT TYPE', target: 'payment_method', values: TEMPLATE_PAYMENT_METHOD_OPTIONS, dbColumn: 'customers.stated_payment_type' },
      { header: 'REF NO', target: 'payment_reference', dbColumn: 'customers.stated_ref_no' },
      { header: 'DATE', target: 'payment_date', dbColumn: 'customers.stated_payment_date' },
    ],
  },
];

/** Every guided-tab column in merge order (duplicates across tabs kept). */
export const CUSTOMER_SSOT_COLUMNS: readonly string[] = CUSTOMER_SSOT_SECTIONS.flatMap(
  (section) => section.columns.map((column) => column.header),
);

/** Section band labels for the flat CSV, one per guided column. */
export const CUSTOMER_SSOT_SECTION_BANDS: readonly string[] = CUSTOMER_SSOT_SECTIONS.flatMap(
  (section) => section.columns.map(() => section.sheet),
);
