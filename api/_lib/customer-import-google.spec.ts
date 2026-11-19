import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGoogleSheetCsv, MAX_SHEET_FETCH_BYTES } from './customer-import.js';
const sheet = 'https://docs.google.com/spreadsheets/d/abcdefghij123/edit#gid=42';
const exportUrl = 'https://docs.google.com/spreadsheets/d/abcdefghij123/export?format=csv&gid=42';
const download = 'https://doc-0c-34-sheets.googleusercontent.com/export/fixture?format=csv';
const csv = 'first_name,last_name\nQA,Disposable\n';
const response = () =>
  new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8' } });
const redirect = (location: string) => new Response(null, { status: 307, headers: { location } });
describe('Google Sheets controlled export redirects', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it('imports a public CSV without redirect from the constructed export URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchGoogleSheetCsv(sheet)).toBe(csv);
    expect(fetcher.mock.calls[0]?.[0]).toBe(exportUrl);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });
  it('follows the observed Google Sheets download host with the same overall signal', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(redirect(download))
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchGoogleSheetCsv(sheet)).toBe(csv);
    expect(fetcher.mock.calls[1]?.[0]).toBe(download);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      redirect: 'manual',
      signal: fetcher.mock.calls[0]?.[1].signal,
    });
  });
  it.each([
    'https://evil.invalid/export/file',
    'https://127.0.0.1/export/file',
    'https://[::1]/export/file',
    'http://doc-0c-34-sheets.googleusercontent.com/export/file',
    'https://user:password@doc-0c-34-sheets.googleusercontent.com/export/file',
    'https://doc-0c-34-sheets.googleusercontent.com:444/export/file',
    'https://doc-0c-34-sheets.googleusercontent.com.evil.invalid/export/file',
    'https://arbitrary.googleusercontent.com/export/file',
    'https://mail.google.com/export/file',
    'https://doc-0c-34-sheets.googleusercontent.com/unrelated',
    'https://docs.google.com/document/d/abcdefghij123/export',
  ])('rejects a forbidden destination before fetching it: %s', async (location) => {
    const fetcher = vi.fn().mockResolvedValue(redirect(location));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchGoogleSheetCsv(sheet)).rejects.toThrow(/redirect.*not permitted/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects a redirect loop', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(redirect(download))
      .mockResolvedValueOnce(redirect(exportUrl));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchGoogleSheetCsv(sheet)).rejects.toThrow(/loop/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('limits redirects to three, validating the last Location without fetching it', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => redirect(download + '&hop=' + fetcher.mock.calls.length));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchGoogleSheetCsv(sheet)).rejects.toThrow(/limit/);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('allows exactly three redirects', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(redirect(download + '&hop=1'))
      .mockResolvedValueOnce(redirect(download + '&hop=2'))
      .mockResolvedValueOnce(redirect(download + '&hop=3'))
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchGoogleSheetCsv(sheet)).toBe(csv);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('rejects an oversized Content-Length and cancels the unread body', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(body, {
            headers: {
              'content-type': 'text/csv',
              'content-length': String(MAX_SHEET_FETCH_BYTES + 1),
            },
          }),
        ),
    );
    await expect(fetchGoogleSheetCsv(sheet)).rejects.toThrow(/size limit/);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(['text/html', 'application/pdf', 'image/png'])(
    'rejects unsupported content %s without exposing it',
    async (contentType) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response('<html>private permission page</html>', {
              headers: { 'content-type': contentType },
            }),
          ),
      );
      await expect(fetchGoogleSheetCsv(sheet)).rejects.toThrow(/OAuth/);
    },
  );
  it.each(['text/csv', 'text/plain', 'application/octet-stream'])(
    'rejects HTML even mislabeled %s',
    async (type) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response('  <!DOCTYPE html><html>Login secret</html>', {
              headers: { 'content-type': type },
            }),
          ),
      );
      await expect(fetchGoogleSheetCsv(sheet)).rejects.toThrow(/OAuth/);
    },
  );
  it('rejects binary control bytes masquerading as CSV', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array([0, 1, 2]), {
            headers: { 'content-type': 'application/octet-stream' },
          }),
        ),
    );
    await expect(fetchGoogleSheetCsv(sheet)).rejects.toThrow(/OAuth/);
  });
  it.each([
    'https://evil.invalid/sheet',
    'https://docs.google.com.evil.invalid/spreadsheets/d/abcdefghij123/edit',
    'https://user:password@docs.google.com/spreadsheets/d/abcdefghij123/edit',
    'http://docs.google.com/spreadsheets/d/abcdefghij123/edit',
    'https://docs.google.com/spreadsheets/d/abcdefghij123/edit?gid=abc',
  ])('rejects invalid initial input before any network request: %s', async (url) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchGoogleSheetCsv(url)).rejects.toThrow(/valid Google/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses one 20-second deadline across redirect hops', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(redirect(download))
      .mockImplementationOnce(
        (_url: string, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal = options.signal;
            signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      );
    vi.stubGlobal('fetch', fetcher);
    const assertion = expect(fetchGoogleSheetCsv(sheet)).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });
});
