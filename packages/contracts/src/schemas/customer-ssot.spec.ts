/**
 * Coverage tripwires for the customer-record SSOT registry.
 *
 * The registry is the single source for the guided template headers, the
 * import remap and the staff export. These assertions pin the company's
 * master list verbatim (order included), and prove every mapped column has a
 * real import key and every dropdown has a known vocabulary - so a header or
 * a key can never drift out of a download unnoticed.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PAYMENT_SCHEMES } from './lifecycle.js';
import {
  CIVIL_STATUS_OPTIONS,
  CITIZENSHIP_OPTIONS,
  SEX_OPTIONS,
  SUFFIX_OPTIONS,
} from './official-forms.js';
import {
  COMPANY_IMPORT_EXTRA_COLUMNS,
  CUSTOMER_IMPORT_COLUMNS,
  mapSourceStatus,
} from './customer-import.js';
import {
  CUSTOMER_SSOT_COLUMNS,
  CUSTOMER_SSOT_SECTION_BANDS,
  CUSTOMER_SSOT_SECTIONS,
  TEMPLATE_PAYMENT_METHOD_OPTIONS,
  TEMPLATE_STATUS_OPTIONS,
  TEMPLATE_TIER_OPTIONS,
} from './customer-ssot.js';

const PRIMARY = [
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
] as const;

const SUPPLEMENTARY = [
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
] as const;

const RELATED = [
  'SVD (NAME)',
  'SSM (NAME)',
  'SM (NAME)',
  'REFERRER (NAME)',
  'VIP RECOMMENDER (NAME)',
  'CONTACT NO.',
  'EMAIL ADDRESS',
] as const;

const PACKAGE = [
  'VIP PACKAGE',
  'PAYMENT TERMS',
  'REGULAR PRICE',
  'DISCOUNT',
  'TOTAL AMOUNT',
  'RF',
  'PAYMENT TYPE',
  'REF NO',
  'DATE',
] as const;

const KNOWN_VOCABULARIES = [
  SUFFIX_OPTIONS,
  SEX_OPTIONS,
  CITIZENSHIP_OPTIONS,
  CIVIL_STATUS_OPTIONS,
  TEMPLATE_STATUS_OPTIONS,
  TEMPLATE_TIER_OPTIONS,
  PAYMENT_SCHEMES,
  TEMPLATE_PAYMENT_METHOD_OPTIONS,
] as const;

describe('customer SSOT registry', () => {
  it('pins the four blocks verbatim, in the company order', () => {
    expect(CUSTOMER_SSOT_SECTIONS.map((section) => section.sheet)).toEqual([
      'Primary',
      'Supplementary',
      'Related',
      'Package',
    ]);
    const headers = (sheet: string) =>
      CUSTOMER_SSOT_SECTIONS.find((section) => section.sheet === sheet)!.columns.map(
        (column) => column.header,
      );
    expect(headers('Primary')).toEqual([...PRIMARY]);
    expect(headers('Supplementary')).toEqual([...SUPPLEMENTARY]);
    expect(headers('Related')).toEqual([...RELATED]);
    expect(headers('Package')).toEqual([...PACKAGE]);
    // The single MOBILE NO. column per block; MOBILE collapsed into it.
    expect(headers('Primary')).not.toContain('MOBILE');
    expect(headers('Supplementary')).not.toContain('MOBILE');
    expect(headers('Primary').filter((h) => h === 'MOBILE NO.')).toHaveLength(1);
    expect(headers('Supplementary').filter((h) => h === 'MOBILE NO.')).toHaveLength(1);
    // FULL NAME never appears: names are always the operator's own split.
    expect(CUSTOMER_SSOT_COLUMNS).not.toContain('FULL NAME');
    expect(CUSTOMER_SSOT_COLUMNS).toHaveLength(62);
    expect(CUSTOMER_SSOT_SECTION_BANDS).toHaveLength(62);
  });

  it('maps every column to a real import key, a join, or reference-only', () => {
    const importable = new Set<string>([...CUSTOMER_IMPORT_COLUMNS, ...COMPANY_IMPORT_EXTRA_COLUMNS]);
    for (const section of CUSTOMER_SSOT_SECTIONS)
      for (const column of section.columns) {
        if (column.join) {
          expect(importable.has(column.join.key)).toBe(true);
          continue;
        }
        if (column.target === null) continue; // reference-only (AGE)
        expect(column.target, column.header).toBeTruthy();
        expect(importable.has(column.target!), `${column.header} -> ${column.target}`).toBe(true);
      }
  });

  it('documents a storage target for every mapped column', () => {
    for (const section of CUSTOMER_SSOT_SECTIONS)
      for (const column of section.columns)
        if (column.target !== null) expect(column.dbColumn, column.header).toBeTruthy();
  });

  it('keeps AGE reference-only and TIN write-only in both member blocks', () => {
    const age = CUSTOMER_SSOT_SECTIONS.flatMap((section) =>
      section.columns.filter((column) => column.header === 'AGE'),
    );
    expect(age).toHaveLength(2);
    for (const column of age) expect(column.target).toBeNull();
    const tins = CUSTOMER_SSOT_SECTIONS.flatMap((section) =>
      section.columns.filter((column) => column.header === 'TIN NO.'),
    );
    expect(tins).toHaveLength(2);
    for (const column of tins) expect(column.sensitivity).toBe('write-only');
  });

  it('joins supplementary names and address parts into the single stored columns', () => {
    const supplementary = CUSTOMER_SSOT_SECTIONS.find(
      (section) => section.sheet === 'Supplementary',
    )!;
    const nameColumns = supplementary.columns.filter((column) => column.join?.key === 'supplementary_full_name');
    expect(nameColumns.map((column) => column.header)).toEqual([
      'FIRST NAME',
      'LAST NAME',
      'MIDDLE NAME',
      'SUFFIX',
    ]);
    const addressColumns = supplementary.columns.filter(
      (column) => column.join?.key === 'supplementary_address',
    );
    expect(addressColumns.map((column) => column.header)).toEqual([
      'PERMANENT ADDRESS LINE 1',
      'PERMANENT ADDRESS LINE 2',
      'PROVINCE',
      'CITY',
      'BARANGGAY',
      'POSTAL CODE',
    ]);
  });

  it('uses only the known vocabularies for every dropdown', () => {
    for (const section of CUSTOMER_SSOT_SECTIONS)
      for (const column of section.columns)
        if (column.values) {
          const known = KNOWN_VOCABULARIES.some(
            (vocabulary) =>
              vocabulary.length === column.values!.length &&
              (vocabulary as readonly string[]).every((value, index) => value === column.values![index]),
          );
          expect(known, `${column.header} dropdown vocabulary`).toBe(true);
        }
  });

  it('round-trips every template status through the source-status mapping', () => {
    for (const status of TEMPLATE_STATUS_OPTIONS)
      expect(mapSourceStatus(status), status).not.toBeNull();
  });

  it('keeps dropdown value hygiene: no commas or quotes inside any value', () => {
    for (const section of CUSTOMER_SSOT_SECTIONS)
      for (const column of section.columns)
        for (const value of column.values ?? []) {
          expect(z.string().refine(() => !/[",]/.test(value)).safeParse(value).success).toBe(true);
        }
  });
});
