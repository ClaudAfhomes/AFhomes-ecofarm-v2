import { afterEach, expect, it, vi } from 'vitest';
import {
  applicationPaperRows,
  applicationPdf,
  renderApplicationPaper,
  printApplicationPages,
  wrapPaperText,
  type ApplicationPrintData,
} from './application-print';
import { emptyHolder } from './official-forms-fields';

const draft: ApplicationPrintData = {
  primary: {
    ...emptyHolder('PRIMARY'),
    firstName: 'MARÍA',
    lastName: 'SANTOS',
    suffix: 'III',
    mobile: '+639171234567',
    email: 'maria@example.test',
  },
  secondary: { ...emptyHolder('SECONDARY'), firstName: 'JOSÉ', lastName: 'SANTOS' },
  planName: 'Gold VIP',
  tier: 'GOLD',
  paymentScheme: 'spot_cash',
  idType: 'Passport',
  idNumber: '',
  recommender: 'ANA CRUZ',
  recommenderAaNumber: 'AAO26100003',
  recommenderContact: '+639181234567',
  recommenderEmail: 'ana@example.test',
  referrer: 'PEDRO CRUZ',
  referrerAaNumber: 'AAO26100001',
  svd: 'SVD NAME',
  ssm: 'SSM NAME',
  sm: 'SM NAME',
  acknowledgedAt: '2026-11-07',
  channels: ['Referral', 'Walk-In'],
  consent: false,
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('uses actual draft values, includes Gold secondary details, and identifies omissions without invented verification', () => {
  const rows = applicationPaperRows(draft);
  const text = JSON.stringify(rows);
  for (const value of [
    'MARÍA',
    'JOSÉ',
    'III',
    'AAO26100003',
    'AAO26100001',
    'ANA CRUZ',
    'PEDRO CRUZ',
    'SVD NAME',
    'SSM NAME',
    'SM NAME',
    'Referral, Walk-In',
    'Not confirmed',
    'Not provided',
  ])
    expect(text).toContain(value);
  expect(rows.filter((row) => row.signature)).toHaveLength(1);
  expect(text).not.toMatch(/verified|approved|signedAt|signatureData/i);
  expect(JSON.stringify(applicationPaperRows({ ...draft, tier: 'SILVER' }))).not.toContain('JOSÉ');
  expect(JSON.stringify(applicationPaperRows({ ...draft, secondary: null }))).not.toContain('JOSÉ');
});

it('wraps long Unicode values and unbroken addresses without truncating characters', () => {
  const text = 'JOSÉ MARÍA '.repeat(20) + 'very-long-email-address@example.test';
  const lines = wrapPaperText(text, 20, (value) => value.length);
  expect(lines.every((line) => line.length <= 20)).toBe(true);
  expect(lines.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
});

it('renders all fields into paginated paper without touching a network or mutating the input', async () => {
  const drawn: string[] = [];
  const context = {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: (text: string) => drawn.push(text),
    measureText: (text: string) => ({ width: text.length * 9 }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/jpeg;base64,/9j/2Q==',
  );
  const input = {
    ...draft,
    primary: { ...draft.primary, officeBusinessAddress: 'Long address '.repeat(25) },
  };
  const before = JSON.stringify(input);
  const pages = await renderApplicationPaper(input);
  expect(pages.length).toBeGreaterThan(0);
  expect(drawn.join(' ')).toContain('SANTOS, MARÍA, III');
  expect(drawn.join(' ')).toContain('Primary cardholder’s signature over printed name');
  expect(drawn.join(' ')).toContain('Secondary cardholder’s signature over printed name');
  expect(drawn.join(' ')).toContain('Date: __________________________');
  expect(drawn.join(' ')).toContain(`Page ${pages.length} of ${pages.length}`);
  expect(JSON.stringify(input)).toBe(before);
});

it('writes A4 pages with byte-correct cross-reference offsets and rejects missing/invalid pages', () => {
  const envelope = applicationPdf([
    'data:image/jpeg;base64,/9j/2Q==',
    'data:image/jpeg;base64,/9j/2Q==',
  ]);
  const pdf = atob(envelope.content);
  expect(envelope.mime).toBe('application/pdf');
  expect(pdf).toContain('/MediaBox [0 0 595.28 841.89]');
  expect(pdf).toContain('/Count 2');
  const offset = Number(pdf.match(/startxref\n(\d+)/)![1]);
  expect(pdf.slice(offset, offset + 4)).toBe('xref');
  const entries = pdf.slice(offset).split('\n').slice(3, 11);
  entries.forEach((entry, index) => {
    const objectOffset = Number(entry.slice(0, 10));
    expect(pdf.slice(objectOffset)).toMatch(new RegExp(`^${index + 1} 0 obj`));
  });
  expect(() => applicationPdf([])).toThrow('No application pages');
  expect(() => applicationPdf(['javascript:alert(1)'])).toThrow('Invalid application page');
});

it('waits for cold fonts before drawing the company header', async () => {
  const original = Object.getOwnPropertyDescriptor(document, 'fonts');
  let ready!: () => void;
  const load = vi.fn().mockResolvedValue([]);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      ready: new Promise<void>((resolve) => {
        ready = resolve;
      }),
      load,
    },
  });
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  try {
    const render = renderApplicationPaper(draft);
    expect(context).not.toHaveBeenCalled();
    ready();
    await expect(render).rejects.toThrow('Document preview is unavailable');
    expect(load).toHaveBeenCalledWith('700 30px Arial');
    expect(load).toHaveBeenCalledWith('17px Arial');
  } finally {
    if (original) Object.defineProperty(document, 'fonts', original);
    else Reflect.deleteProperty(document, 'fonts');
  }
});

it('prints only the isolated A4 document after its images load and removes it after printing', async () => {
  vi.useFakeTimers();
  const printing = printApplicationPages(['data:image/jpeg;base64,/9j/2Q==']);
  const frame = document.querySelector('iframe')!;
  const win = frame.contentWindow!;
  const print = vi.spyOn(win, 'print').mockImplementation(() => {});
  vi.spyOn(win, 'focus').mockImplementation(() => {});
  expect(print).not.toHaveBeenCalled();
  expect(frame.contentDocument!.querySelector('style')!.textContent).toContain('size:A4 portrait');
  frame.contentDocument!.querySelector('img')!.dispatchEvent(new Event('load'));
  await printing;
  expect(print).toHaveBeenCalledOnce();
  win.dispatchEvent(new Event('afterprint'));
  expect(document.querySelector('iframe')).toBeNull();
});
