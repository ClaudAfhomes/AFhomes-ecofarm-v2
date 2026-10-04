import { afterEach, expect, it, vi } from 'vitest';
import { OST_IMPORT_COLUMNS, parseOstImportRow, readOstImport } from './ost-import.js';
import { toCsv, toXlsx } from './report-export.js';
const fields: Record<string, string> = {
  first_name: 'QA',
  last_name: 'TESTER',
  email: 'qa@example.invalid',
  mobile: '09171234567',
  birth_date: '1990-01-01',
  address: 'QA STREET',
  city: 'QA CITY',
  province: 'QA PROVINCE',
  sponsor_staff_id: '00000000-0000-4000-8000-000000000001',
  date_applied: '2026-01-01',
  program_category: 'non_vip',
  sex: 'male',
  civil_status: 'single',
  government_id_type: 'QA',
  government_id_number: 'SYNTHETIC',
};
afterEach(() => vi.unstubAllGlobals());
it('validates OST-specific required fields rather than customer import fields', () =>
  expect(parseOstImportRow(fields).success).toBe(true));
it('does not resolve a sponsor from an arbitrary name', () =>
  expect(parseOstImportRow({ ...fields, sponsor_staff_id: 'QA MANAGER' }).success).toBe(false));
it('rejects invalid mobile numbers', () =>
  expect(parseOstImportRow({ ...fields, mobile: 'CALL ME' }).success).toBe(false));
it('parses a real CSV file with complete header fidelity', async () => {
  const csv = toCsv([...OST_IMPORT_COLUMNS], [OST_IMPORT_COLUMNS.map((c) => fields[c] ?? '')]);
  const rows = await readOstImport({
    source: 'csv',
    sourceName: 'qa.csv',
    mime: 'text/csv',
    contentBase64: Buffer.from(csv).toString('base64'),
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.fields.government_id_number).toBe('SYNTHETIC');
});
it('parses the real XLSX template writer output', async () => {
  const bytes = toXlsx(
    'OST',
    OST_IMPORT_COLUMNS.map((label) => ({ label, type: 'text' })),
    [OST_IMPORT_COLUMNS.map((c) => fields[c] ?? '')],
  );
  const rows = await readOstImport({
    source: 'excel',
    sourceName: 'qa.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    contentBase64: Buffer.from(bytes).toString('base64'),
  });
  expect(rows[0]?.fields.email).toBe(fields.email);
});
it('rejects disguised XLSX files', async () =>
  await expect(
    readOstImport({
      source: 'excel',
      sourceName: 'qa.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentBase64: Buffer.from('not an XLSX').toString('base64'),
    }),
  ).rejects.toThrow('XLSX'));
it('rejects non-Google URLs without an outbound request', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(
    readOstImport({
      source: 'google_sheets',
      sourceName: 'qa',
      sheetUrl: 'https://example.com/fixture',
    }),
  ).rejects.toThrow('Google');
  expect(fetch).not.toHaveBeenCalled();
});
it('uses the hardened Google-owned export construction', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        toCsv([...OST_IMPORT_COLUMNS], [OST_IMPORT_COLUMNS.map((c) => fields[c] ?? '')]),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  const rows = await readOstImport({
    source: 'google_sheets',
    sourceName: 'qa',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/qaSyntheticSheetId123456/edit',
  });
  expect(rows).toHaveLength(1);
  expect(fetch.mock.calls[0]?.[0]).toContain('docs.google.com/spreadsheets/d/');
});
