import { afterEach, expect, it, vi } from 'vitest';
import { downloadFile, envelopeBlob } from './download';
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each([
  'afhomes-customer-application-template.xlsx',
  'afhomes-ist-agreement-template.xlsx',
  'afhomes-ost-accreditation-template.pdf',
  'afhomes-ost-template.csv',
])(
  'invokes a browser download with the exact filename %s and delays URL revocation',
  (filename) => {
    vi.useFakeTimers();
    const create = vi.fn((blob: Blob) => {
      void blob;
      return 'blob:qa-template';
    });
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    let clicked: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked = document.querySelector<HTMLAnchorElement>('a[download]') ?? undefined;
      expect(this.isConnected).toBe(true);
    });
    downloadFile({ filename, mime: 'application/pdf', content: btoa('SYNTHETIC QA TEMPLATE') });
    expect(clicked?.download).toBe(filename);
    expect(clicked?.href).toBe('blob:qa-template');
    expect(clicked?.isConnected).toBe(false);
    expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:qa-template');
  },
);
it('decodes the actual envelope content and preserves its MIME', async () => {
  const blob = envelopeBlob({ mime: 'text/csv', content: btoa('name,status\r\nQA,pending') });
  expect(blob.type).toBe('text/csv');
  const content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
  expect(content).toBe('name,status\r\nQA,pending');
});
