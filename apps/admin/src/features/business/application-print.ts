import { paymentSchemeLabel, type ApplicationHolder, type PaymentScheme } from '@afhomes/contracts';
import type { DownloadEnvelope } from '../../lib/download';

export type ApplicationPrintData = {
  primary: ApplicationHolder;
  secondary: ApplicationHolder | null;
  tier: string;
  planName?: string;
  paymentScheme: PaymentScheme;
  idType: string;
  idNumber: string;
  recommender: string;
  recommenderAaNumber: string;
  recommenderContact: string;
  recommenderEmail: string;
  referrer: string;
  referrerAaNumber: string;
  svd: string;
  ssm: string;
  sm: string;
  acknowledgedAt: string;
  channels: string[];
  consent: boolean;
};
type Cell = { label: string; value: string };
export type PaperRow = { heading?: string; cells?: Cell[]; signature?: boolean };
const cell = (label: string, value?: string | null): Cell => ({
  label,
  value: value?.trim() || 'Not provided',
});

/** Uses draft values only. No signatures, approval, submission, or ID verification are inferred. */
export function applicationPaperRows(data: ApplicationPrintData): PaperRow[] {
  const holder = (value: ApplicationHolder, label: string): PaperRow[] => [
    { heading: label },
    {
      cells: [
        cell(
          'Last name, first name, middle name, suffix',
          [value.lastName, value.firstName, value.middleName, value.suffix]
            .filter(Boolean)
            .join(', '),
        ),
        cell('Prefix', value.prefix),
      ],
    },
    {
      cells: [
        cell('Date of birth', value.birthDate),
        cell('Sex', value.sex),
        cell('Citizenship', value.citizenship),
        cell('Civil status', value.civilStatus),
      ],
    },
    {
      cells: [
        cell(
          'Permanent address',
          [
            value.permanentAddressLine1,
            value.permanentAddressLine2,
            value.barangay,
            value.cityMunicipality,
            value.province,
            value.postalCode,
          ]
            .filter(Boolean)
            .join(', '),
        ),
      ],
    },
    {
      cells: [
        cell('Landline', value.landline),
        cell('Mobile', value.mobile),
        cell('Email', value.email),
        cell('TIN', value.tinNumber),
      ],
    },
    {
      cells: [
        cell('Occupation / business name', value.occupationBusinessName),
        cell('Office / business address', value.officeBusinessAddress),
      ],
    },
    {
      cells: [
        cell('Business / industry', value.businessIndustry),
        cell('Employed position', value.employedPosition),
      ],
    },
    {
      cells: [
        cell('Customer ID', value.raNumber),
        cell('Card printed name', value.printedName),
      ],
    },
  ];
  return [
    ...holder(data.primary, 'PRIMARY CARDHOLDER'),
    ...(data.tier === 'GOLD' && data.secondary
      ? holder(data.secondary, 'SECONDARY CARDHOLDER · GOLD')
      : [{ heading: 'SECONDARY CARDHOLDER · Not included (Gold only)' }]),
    { heading: 'VIP PRIVILEGE CARD DETAILS' },
    {
      cells: [
        cell('VIP plan', data.planName || data.tier),
        cell('Payment terms', paymentSchemeLabel(data.paymentScheme)),
      ],
    },
    {
      cells: [
        cell('Government ID type', data.idType),
        cell('Government ID number (as entered)', data.idNumber),
      ],
    },
    { heading: 'VIP RECOMMENDER’S DETAILS' },
    {
      cells: [
        cell('VIP recommender', data.recommender),
        cell('AA number', data.recommenderAaNumber),
        cell('Contact number', data.recommenderContact),
        cell('Email', data.recommenderEmail),
      ],
    },
    {
      cells: [
        cell('Referrer of VIP recommender', data.referrer),
        cell('Referrer AA number', data.referrerAaNumber),
      ],
    },
    {
      cells: [
        cell('SVD', data.svd),
        cell('SSM', data.ssm),
        cell('Sales manager', data.sm),
        cell('Acknowledged at', data.acknowledgedAt),
      ],
    },
    { heading: 'CLIENT ACQUISITION CHANNEL' },
    { cells: [cell('Selected channels', data.channels.join(', '))] },
    { heading: 'CERTIFICATION' },
    {
      cells: [
        cell(
          'Certification and data privacy consent',
          'I certify the information and consent to verification and processing under RA 10173.',
        ),
      ],
    },
    {
      cells: [
        cell(
          'Certification selection in this draft',
          data.consent ? 'Confirmed by applicant in the application' : 'Not confirmed',
        ),
      ],
    },
    { signature: true },
  ];
}

const WIDTH = 1240;
const HEIGHT = 1754;
const MARGIN = 48;

/** Wrap even unbroken email/address strings without dropping characters. */
export function wrapPaperText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const char of text.replace(/\s+/g, ' ').trim()) {
    if (line && measure(line + char) > maxWidth) {
      const space = line.lastIndexOf(' ');
      if (space > 0) {
        lines.push(line.slice(0, space));
        line = line.slice(space + 1) + char;
      } else {
        lines.push(line);
        line = char;
      }
    } else line += char;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** Raster pages preserve Unicode names without shipping a font or sending PII to a service. */
export function renderApplicationPaper(data: ApplicationPrintData): Promise<string[]> {
  return renderPaperRows(applicationPaperRows(data), {
    title: 'VIP PRIVILEGE CARD APPLICATION FORM',
    footer: 'Application preview - Not submitted or approved - Unsigned',
    secondary: data.tier === 'GOLD' && Boolean(data.secondary),
  });
}

export async function renderPaperRows(
  rows: readonly PaperRow[],
  options: {
    title: string;
    footer: string;
    secondary: boolean;
    compact?: boolean;
  },
): Promise<string[]> {
  // Cold browser fonts can otherwise leave the first header/footer blank on canvas.
  if (document.fonts) {
    await document.fonts.ready;
    await Promise.all([document.fonts.load('700 30px Arial'), document.fonts.load('17px Arial')]);
  }
  const canvases: HTMLCanvasElement[] = [];
  let context: CanvasRenderingContext2D;
  let y = 0;
  const write = (text: string, x: number, top: number, size = 17, bold = false) => {
    context.font = `${bold ? '700' : '400'} ${size}px Arial, sans-serif`;
    context.fillStyle = '#24392e';
    context.fillText(text, x, top);
  };
  const page = () => {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Document preview is unavailable in this browser.');
    context = ctx;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.textBaseline = 'top';
    context.strokeStyle = '#9aab9d';
    write('AFhomes', MARGIN, 30, 30, true);
    write('AFHOMES HOTSPRING & ECOFARM RESORT CORP.', MARGIN, 67, 13);
    write(options.title, MARGIN, 94, 22, true);
    write(options.footer, MARGIN, HEIGHT - 48, 13);
    canvases.push(canvas);
    y = 135;
  };
  page();
  for (const row of rows) {
    const cells = row.cells ?? [];
    const cellWidth = (WIDTH - 2 * MARGIN) / Math.max(1, cells.length);
    const valueSize = options.compact ? 15 : 17;
    const valueLineHeight = options.compact ? 18 : 21;
    context!.font = `${valueSize}px Arial, sans-serif`;
    const wrapped = cells.map((c) =>
      wrapPaperText(c.value, cellWidth - 20, (value) => context.measureText(value).width),
    );
    context!.font = `${options.compact ? 11 : 12}px Arial, sans-serif`;
    const labels = cells.map((c) =>
      wrapPaperText(c.label, cellWidth - 20, (value) => context.measureText(value).width),
    );
    const valueTop = 12 + Math.max(1, ...labels.map((lines) => lines.length)) * 14;
    const height = row.heading
      ? 30
      : row.signature
        ? options.compact
          ? 130
          : 140
        : Math.max(
            options.compact ? 44 : 50,
            valueTop + Math.max(1, ...wrapped.map((lines) => lines.length)) * valueLineHeight + 5,
          );
    if (y + height > HEIGHT - 80) page();
    if (row.heading) {
      context!.fillStyle = '#e0ebd0';
      context!.fillRect(MARGIN, y, WIDTH - 2 * MARGIN, height);
      write(row.heading, MARGIN + 10, y + 7, 16, true);
    } else if (row.signature) {
      const signature = (x: number, label: string) => {
        context.beginPath();
        context.moveTo(x, y + 48);
        context.lineTo(x + 510, y + 48);
        context.stroke();
        write(label, x, y + 56, 13);
      };
      signature(MARGIN, 'Primary cardholder’s signature over printed name');
      if (options.secondary)
        signature(MARGIN + 590, 'Secondary cardholder’s signature over printed name');
      write('Date: __________________________', MARGIN, y + 105, 16);
    } else {
      cells.forEach((_, index) => {
        const x = MARGIN + index * cellWidth;
        context.strokeRect(x, y, cellWidth, height);
        labels[index]!.forEach((line, i) =>
          write(line, x + 10, y + 7 + i * 14, options.compact ? 11 : 12, true),
        );
        wrapped[index]!.forEach((line, i) =>
          write(line, x + 10, y + valueTop + i * valueLineHeight, valueSize),
        );
      });
    }
    y += height;
  }
  return canvases.map((canvas, index) => {
    context = canvas.getContext('2d')!;
    write(`Page ${index + 1} of ${canvases.length}`, WIDTH - 150, HEIGHT - 48, 13);
    return canvas.toDataURL('image/jpeg', 0.96);
  });
}

/** A4 JPEG PDF container, adapted from the approved V4 reference. */
export function applicationPdf(
  pages: readonly string[],
  filename = 'AFhomes-Customer-Application.pdf',
): DownloadEnvelope {
  if (!pages.length) throw new Error('No application pages to download.');
  const chunks: Uint8Array[] = [];
  const offsets = [0];
  let total = 0;
  const add = (value: string | Uint8Array) => {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    chunks.push(bytes);
    total += bytes.length;
  };
  const object = (id: number, body: string) => {
    offsets[id] = total;
    add(`${id} 0 obj\n${body}\nendobj\n`);
  };
  add('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(
    2,
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  pages.forEach((dataUrl, i) => {
    if (!dataUrl.startsWith('data:image/jpeg;base64,'))
      throw new Error('Invalid application page.');
    const jpeg = Uint8Array.from(atob(dataUrl.split(',')[1]!), (c) => c.charCodeAt(0));
    const id = 3 + i * 3;
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Img ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
    );
    offsets[id + 1] = total;
    add(
      `${id + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${WIDTH} /Height ${HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    );
    add(jpeg);
    add('\nendstream\nendobj\n');
    const commands = 'q 595.28 0 0 841.89 0 0 cm /Img Do Q\n';
    object(id + 2, `<< /Length ${commands.length} >>\nstream\n${commands}endstream`);
  });
  const xref = total;
  add(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach((offset) => add(`${String(offset).padStart(10, '0')} 00000 n \n`));
  add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const binary = chunks
    .map((bytes) => {
      let text = '';
      for (const byte of bytes) text += String.fromCharCode(byte);
      return text;
    })
    .join('');
  return {
    filename,
    mime: 'application/pdf',
    content: btoa(binary),
  };
}

export async function printApplicationPages(
  pages: readonly string[],
  title = 'AFhomes Customer Application',
): Promise<void> {
  const frame = document.createElement('iframe');
  frame.title = `Print ${title}`;
  frame.style.cssText = 'position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;';
  document.body.append(frame);
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) throw new Error('Print window could not be opened.');
    doc.title = title;
    const style = doc.createElement('style');
    style.textContent =
      '@page{size:A4 portrait;margin:0}body{margin:0}img{display:block;width:210mm;height:297mm;break-after:page}img:last-child{break-after:auto}';
    doc.head.append(style);
    await Promise.all(
      pages.map(
        (src) =>
          new Promise<void>((resolve, reject) => {
            const img = doc.createElement('img');
            img.onload = () => resolve();
            img.onerror = () =>
              reject(new Error('Application page could not be loaded for printing.'));
            img.src = src;
            doc.body.append(img);
          }),
      ),
    );
    win.addEventListener('afterprint', () => frame.remove(), { once: true });
    win.focus();
    win.print();
    window.setTimeout(() => frame.remove(), 120_000);
  } catch (error) {
    frame.remove();
    throw error;
  }
}
