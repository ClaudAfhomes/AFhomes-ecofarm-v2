import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractIdentityDocument,
  httpProvider,
  manualProvider,
  OCR_LOW_CONFIDENCE,
  OCR_NO_TEXT,
  OCR_UNAVAILABLE,
  selectProvider,
} from './ocr.js';

const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('provider selection', () => {
  it('defaults to the manual provider: onboarding never needs OCR', async () => {
    vi.stubEnv('OCR_PROVIDER_URL', '');
    expect(selectProvider().name).toBe('manual');
    const result = await extractIdentityDocument(bytes, 'image/jpeg');
    expect(result.provider).toBe('manual');
    expect(result.fields).toEqual({});
    expect(result.warnings).toContain(OCR_UNAVAILABLE);
  });

  it('selects the HTTP provider only when configured', () => {
    vi.stubEnv('OCR_PROVIDER_URL', 'https://ocr.example/v1/extract');
    expect(selectProvider().name).toBe('http');
  });
});

describe('manual provider', () => {
  it('reports unavailable without touching the network', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await manualProvider.extract(bytes, 'image/jpeg');
    expect(result.warnings).toContain(OCR_UNAVAILABLE);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('HTTP provider', () => {
  it('sends bytes server-side with the server-only key and parses fields', async () => {
    vi.stubEnv('OCR_PROVIDER_URL', 'https://ocr.example/v1/extract');
    vi.stubEnv('OCR_PROVIDER_API_KEY', 'server-secret');
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        fields: {
          firstName: { value: 'Ana', confidence: 0.95 },
          idNumber: 'P1234567',
        },
        rawText: 'secret raw text',
        warnings: [],
      }),
    }));
    vi.stubGlobal('fetch', fetch);
    const result = await httpProvider.extract(bytes, 'image/jpeg');
    expect(result.fields.firstName).toEqual({ value: 'Ana', confidence: 0.95 });
    expect(result.fields.idNumber).toEqual({ value: 'P1234567', confidence: null });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer server-secret' });
    expect(JSON.stringify(init.body)).not.toContain('server-secret');
  });

  it('maps provider failures to warnings, never exceptions', async () => {
    vi.stubEnv('OCR_PROVIDER_URL', 'https://ocr.example/v1/extract');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })),
    );
    const result = await extractIdentityDocument(bytes, 'image/jpeg');
    expect(result.fields).toEqual({});
    expect(result.warnings.some((w) => w.startsWith('OCR_FAILED'))).toBe(true);
  });

  it('flags empty extractions and low confidence for the reviewer', async () => {
    vi.stubEnv('OCR_PROVIDER_URL', 'https://ocr.example/v1/extract');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ fields: {} }) })),
    );
    const empty = await extractIdentityDocument(bytes, 'image/jpeg');
    expect(empty.warnings).toContain(OCR_NO_TEXT);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ fields: { idNumber: { value: 'P1', confidence: 0.2 } } }),
      })),
    );
    const low = await extractIdentityDocument(bytes, 'image/jpeg');
    expect(low.warnings).toContain(OCR_LOW_CONFIDENCE);
  });
});
