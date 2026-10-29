import { readFileSync } from 'node:fs';
import { z } from 'zod';

const rowSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string(),
  z.string().regex(/^\d{4}$/),
]);
const rows = z
  .array(rowSchema)
  .parse(
    JSON.parse(
      readFileSync(
        new URL('../../packages/contracts/assets/postal/national-reference.json', import.meta.url),
        'utf8',
      ),
    ),
  );
const key = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/^city of\s+|\s+city$/g, '')
    .replace(/\bsta\.?\s/g, 'santa ')
    .replace(/\bsto\.?\s/g, 'santo ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Current PSGC spellings against the dated reference's own vocabulary.
 *
 * The reference preserves its source's era names. PSGC Cloud (checked live on
 * 2026-10-16, 82 provinces) spells nine of those scopes differently, and two
 * are successors of a reference-era composite:
 *   Davao de Oro      = Compostela Valley (renamed 2019)
 *   Samar             = Western Samar (reference-era name)
 *   Occidental Mindoro / Oriental Mindoro
 *                     = Mindoro Occidental / Mindoro Oriental (renamed)
 *   Cotabato / South Cotabato
 *                     = North Cotobato / South Cotobato (renamed + source misspelling)
 *   Surigao del Norte = Suriagao del Norte (source misspelling)
 *   Kalinga, Apayao   = Kalinga-Apayao (split 1995; both successors map to the
 *                       composite, so only an exact locality match can win)
 *   Maguindanao del Norte / Maguindanao del Sur
 *                     = Maguindanao (split 2022; same exact-match rule)
 *   Quezon            = Quezon Province (one source row was parented to a bare
 *                       "Quezon", so both spellings canonicalise together)
 *
 * The table maps any accepted spelling to the reference's own canonical
 * spelling and is applied to BOTH the lookup key and the reference index, so a
 * stored older spelling keeps working. It never invents a district chain and
 * never lifts a code from an unrelated equal-named municipality: a genuinely
 * overlapping locality still resolves to several codes and is held for review.
 * Davao Occidental and Dinagat Islands have no reference rows at all and stay
 * honest review holds until a stronger source is verified.
 */
const provinceAlias: Record<string, string> = {
  'davao de oro': 'compostela valley',
  samar: 'western samar',
  'occidental mindoro': 'mindoro occidental',
  'oriental mindoro': 'mindoro oriental',
  cotabato: 'north cotobato',
  'south cotabato': 'south cotobato',
  'surigao del norte': 'suriagao del norte',
  kalinga: 'kalinga apayao',
  apayao: 'kalinga apayao',
  'maguindanao del norte': 'maguindanao',
  'maguindanao del sur': 'maguindanao',
  quezon: 'quezon province',
};
const provinceKey = (name: string) => provinceAlias[key(name)] ?? key(name);
// PHLPost lists Nagtipunan; the pinned reference retains its older "(Abbag)" label.
// https://phlpost.gov.ph/zip-code-locator/ (verified 2026-10-28)
const localityAlias: Record<string, string> = {
  'quirino:nagtipunan': 'quirino:nagtipunan abbag',
};
const localityKey = (province: string, locality: string) => {
  const scope = `${provinceKey(province)}:${key(locality)}`;
  return localityAlias[scope] ?? scope;
};
const byLocality = new Map<string, typeof rows>();
for (const row of rows) {
  const scopeKey = localityKey(row[0], row[1]);
  const entries = byLocality.get(scopeKey) ?? [];
  entries.push(row);
  byLocality.set(scopeKey, entries);
}

/** Resolve only a unique reference match; PSGC Cloud ZIP values are never a fallback. */
export function resolvePostalCode(
  province: string,
  locality: string,
  barangay = '',
): { status: 'matched'; postalCode: string } | { status: 'review'; reason: string } {
  const scope = byLocality.get(localityKey(province, locality)) ?? [];
  if (
    barangay &&
    key(barangay) !== key(locality) &&
    byLocality.has(localityKey(province, barangay))
  )
    return { status: 'review', reason: 'Postal district requires an explicit parent-city mapping' };
  const exact = scope.filter(([, , district]) => district && key(district) === key(barangay));
  const candidates = exact.length ? exact : scope;
  const codes = new Set(candidates.map((row) => row[3]));
  if (codes.size !== 1)
    return {
      status: 'review',
      reason: codes.size
        ? 'Multiple postal areas; choose a supported barangay/district'
        : 'No postal reference match for this verified geography',
    };
  return { status: 'matched', postalCode: [...codes][0]! };
}
