/**
 * AF Homes Phase 12 - provider-neutral OCR abstraction.
 *
 * Core application code depends ONLY on this module, never on a provider SDK:
 * a future provider is a new `OcrProvider` implementation plus one selection
 * branch, with no onboarding rewrite.
 *
 * Providers:
 *
 * - `manualProvider` (default): reports `OCR_UNAVAILABLE`. The workflow
 *   continues with manual entry - onboarding never fails for want of OCR.
 * - `httpProvider`: an optional generic HTTP OCR endpoint configured with the
 *   server-only `OCR_PROVIDER_URL` / `OCR_PROVIDER_API_KEY`. The expected
 *   response contract is `{ fields: { <name>: { value, confidence? } },
 *   rawText?, warnings? }`, parsed tolerantly; anything else is a clean
 *   provider failure, never an exception past this module.
 *
 * `extract()` never throws: every failure mode (unsupported image, timeout,
 * bad response, network error, unconfigured provider) becomes a result with
 * `fields: {}` and a machine-readable warning, so the caller always has a
 * manual-fallback path to offer.
 */

export type OcrFieldValue = { value: string | null; confidence: number | null };

export type OcrExtraction = {
  provider: string;
  fields: Record<string, OcrFieldValue>;
  warnings: string[];
};

export type OcrProvider = {
  name: string;
  extract: (bytes: Uint8Array, mime: string) => Promise<OcrExtraction>;
};

export const OCR_UNAVAILABLE = 'OCR_UNAVAILABLE';
export const OCR_FAILED = 'OCR_FAILED';
export const OCR_NO_TEXT = 'OCR_NO_TEXT_DETECTED';
export const OCR_LOW_CONFIDENCE = 'OCR_LOW_CONFIDENCE';

/** Field names the onboarding review UI understands. Unknown names pass through. */
export const OCR_KNOWN_FIELDS = [
  'fullName',
  'firstName',
  'middleName',
  'lastName',
  'dateOfBirth',
  'address',
  'idNumber',
  'documentNumber',
  'documentType',
  'expiryDate',
] as const;

/** Confidence below which the review UI must warn before confirming. */
export const OCR_LOW_CONFIDENCE_THRESHOLD = 0.6;

const empty = (provider: string, warnings: string[]): OcrExtraction => ({
  provider,
  fields: {},
  warnings,
});

/** Default provider: no OCR configured. Manual entry carries the workflow. */
export const manualProvider: OcrProvider = {
  name: 'manual',
  extract: async () => empty('manual', [OCR_UNAVAILABLE]),
};

const asField = (raw: unknown): OcrFieldValue | null => {
  if (raw === null || raw === undefined) return { value: null, confidence: null };
  if (typeof raw === 'string') return { value: raw.slice(0, 200), confidence: null };
  if (typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    const value = typeof rec.value === 'string' ? rec.value.slice(0, 200) : null;
    const confidence =
      typeof rec.confidence === 'number' && rec.confidence >= 0 && rec.confidence <= 1
        ? rec.confidence
        : null;
    if (value === null && confidence === null) return null;
    return { value, confidence };
  }
  return null;
};

const CONFIGURE_TIMEOUT_MS = 25000;

const fromHttpResponse = (body: unknown): OcrExtraction => {
  const rec = (body ?? {}) as Record<string, unknown>;
  const rawFields = (rec.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, OcrFieldValue> = {};
  for (const [key, raw] of Object.entries(rawFields).slice(0, 40)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) continue;
    const field = asField(raw);
    if (field) fields[key] = field;
  }
  const warnings = Array.isArray(rec.warnings)
    ? rec.warnings.filter((w): w is string => typeof w === 'string').slice(0, 10)
    : [];
  if (Object.keys(fields).length === 0) warnings.push(OCR_NO_TEXT);
  return { provider: 'http', fields, warnings };
};

/** Optional generic HTTP OCR provider. Reads only server-only env. */
export const httpProvider: OcrProvider = {
  name: 'http',
  extract: async (bytes, mime) => {
    const url = process.env.OCR_PROVIDER_URL;
    const key = process.env.OCR_PROVIDER_API_KEY;
    if (!url) return empty('http', [OCR_UNAVAILABLE]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIGURE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          mime,
          imageBase64: Buffer.from(bytes).toString('base64'),
        }),
      });
      if (!response.ok) return empty('http', [`${OCR_FAILED}:provider_status_${response.status}`]);
      return fromHttpResponse(await response.json().catch(() => null));
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      return empty('http', [
        name === 'AbortError' ? `${OCR_FAILED}:provider_timeout` : `${OCR_FAILED}:provider_error`,
      ]);
    } finally {
      clearTimeout(timer);
    }
  },
};

/** Provider selection: optional HTTP endpoint when configured, else manual. */
export function selectProvider(): OcrProvider {
  return process.env.OCR_PROVIDER_URL ? httpProvider : manualProvider;
}

/** Run the configured provider. Never throws; failures become warnings. */
export async function extractIdentityDocument(
  bytes: Uint8Array,
  mime: string,
  provider: OcrProvider = selectProvider(),
): Promise<OcrExtraction> {
  try {
    const result = await provider.extract(bytes, mime);
    const warnings = [...result.warnings];
    const low = Object.entries(result.fields).filter(
      ([, f]) =>
        f.value !== null && f.confidence !== null && f.confidence < OCR_LOW_CONFIDENCE_THRESHOLD,
    );
    if (low.length > 0 && !warnings.includes(OCR_LOW_CONFIDENCE)) warnings.push(OCR_LOW_CONFIDENCE);
    if (
      Object.keys(result.fields).length === 0 &&
      !warnings.includes(OCR_NO_TEXT) &&
      !warnings.includes(OCR_UNAVAILABLE)
    ) {
      warnings.push(OCR_NO_TEXT);
    }
    return { provider: result.provider, fields: result.fields, warnings };
  } catch {
    return empty(provider.name, [`${OCR_FAILED}:provider_threw`]);
  }
}
