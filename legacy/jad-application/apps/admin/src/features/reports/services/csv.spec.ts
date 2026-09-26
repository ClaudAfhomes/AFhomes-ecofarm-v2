import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadCsv, toCsv, type CsvColumn } from './csv';

interface Row {
  id: string;
  name: string;
  amount: string;
}

const COLUMNS: CsvColumn<Row>[] = [
  { key: 'id', header: 'ID', value: (r) => r.id },
  { key: 'name', header: 'Name', value: (r) => r.name },
  { key: 'amount', header: 'Amount', value: (r) => r.amount },
];

describe('toCsv', () => {
  it('renders the header and CRLF rows', () => {
    const csv = toCsv(COLUMNS, [
      { id: 'sal-001', name: 'Farm Lot', amount: '1200000.00' },
      { id: 'sal-002', name: 'Condo', amount: '500000.00' },
    ]);
    expect(csv).toBe(
      'ID,Name,Amount\r\nsal-001,Farm Lot,1200000.00\r\nsal-002,Condo,500000.00',
    );
  });

  it('quotes cells containing commas, quotes, and newlines', () => {
    const csv = toCsv(COLUMNS, [
      { id: 'a', name: 'Lot, with "quote" and\nnewline', amount: '1.00' },
    ]);
    expect(csv).toContain('"Lot, with ""quote"" and\nnewline"');
  });

  it('renders empty cells for missing values', () => {
    const columns: CsvColumn<Row>[] = [
      { key: 'id', header: 'ID', value: (r) => r.id },
      { key: 'name', header: 'Referrer', value: () => '' },
    ];
    expect(toCsv(columns, [{ id: 'a', name: '', amount: '' }])).toBe('ID,Referrer\r\na,');
  });
});

describe('downloadCsv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a BOM-prefixed blob download and cleans up', () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadCsv('report-20260918.csv', 'ID\r\na');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toContain('text/csv');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
