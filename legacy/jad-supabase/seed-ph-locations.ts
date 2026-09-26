/**
 * Philippine administrative reference seed (PSGC-derived).
 *
 * Fills `ph_provinces` / `ph_cities` / `ph_barangays` (created by migration
 * 20261020000005) from an official PSGC-derived extract. Data is fetched or
 * read ONCE at seed time and lives in our database afterwards - there is no
 * runtime third-party dependency and nothing ships to the client bundle
 * (the registration UI pages through `GET /locations/*`).
 *
 * Source: the quarterly PSGC publication of the Philippine Statistics
 * Authority (https://psa.gov.ph/classification/psgc), converted to the
 * shape below. Community mirrors with the same provenance exist
 * (convert once, keep the file), but the canonical input is always an
 * explicit file or URL - never a hardcoded remote.
 *
 * Expected JSON shape:
 *   {
 *     "provinces": [{ "code": "0128", "name": "Ilocos Norte",
 *                     "regionCode": "01", "regionName": "Ilocos Region" }],
 *     "cities": [{ "code": "012801", "name": "Laoag City",
 *                  "provinceCode": "0128" | null, "isCity": true }],
 *     "barangays": [{ "code": "012801001", "name": "Brgy 1", "cityCode": "012801" }]
 *   }
 * Independent/component cities carry `provinceCode: null` and are served as
 * top-level entries alongside provinces.
 *
 * Run: pnpm seed:locations --file ./psgc.json [--dry-run]
 *   or pnpm seed:locations --url https://example.com/psgc.json [--dry-run]
 * Requires: VITE_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
 */

import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

function loadEnvFile(path: string) {
  try {
    const content = fs.readFileSync(path, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env) && value) process.env[key] = value;
    }
  } catch {}
}
loadEnvFile('.env');
loadEnvFile('apps/web/.env.local');
loadEnvFile('apps/admin/.env.local');

type ProvinceIn = { code: unknown; name: unknown; regionCode: unknown; regionName: unknown };
type CityIn = { code: unknown; name: unknown; provinceCode: unknown; isCity: unknown };
type BarangayIn = { code: unknown; name: unknown; cityCode: unknown };
type Dataset = { provinces: ProvinceIn[]; cities: CityIn[]; barangays: BarangayIn[] };

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function fail(message: string): never {
  console.error(`seed-ph-locations: ${message}`);
  process.exit(1);
}

async function loadDataset(): Promise<Dataset> {
  const args = process.argv.slice(2);
  const fileFlag = args.indexOf('--file');
  const urlFlag = args.indexOf('--url');
  let raw: string;
  if (fileFlag !== -1 && args[fileFlag + 1]) {
    try {
      raw = fs.readFileSync(args[fileFlag + 1] as string, 'utf8');
    } catch {
      fail(`cannot read file ${args[fileFlag + 1]}`);
    }
  } else if (urlFlag !== -1 && args[urlFlag + 1]) {
    const res = await fetch(args[urlFlag + 1] as string);
    if (!res.ok) fail(`fetch failed: HTTP ${res.status}`);
    raw = (await res.text()) as string;
  } else {
    fail('provide --file <path> or --url <url> pointing at the PSGC JSON extract');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string);
  } catch {
    fail('input is not valid JSON');
  }
  const data = parsed as Partial<Dataset>;
  if (!Array.isArray(data.provinces) || !Array.isArray(data.cities) || !Array.isArray(data.barangays)) {
    fail('input must have provinces/cities/barangays arrays');
  }
  return data as Dataset;
}

function main(): void {
  loadDataset()
    .then(async (data) => {
      // Fail-closed shape + hierarchy validation BEFORE any write.
      const provinces = data.provinces.filter(
        (p) =>
          nonEmptyString(p.code) &&
          nonEmptyString(p.name) &&
          nonEmptyString(p.regionCode) &&
          nonEmptyString(p.regionName),
      );
      if (provinces.length === 0) fail('no valid provinces in input');
      if (provinces.length !== data.provinces.length) {
        fail(`${data.provinces.length - provinces.length} province rows failed shape validation`);
      }
      const provinceCodes = new Set(provinces.map((p) => (p.code as string).trim()));
      const cities = data.cities.filter(
        (c) =>
          nonEmptyString(c.code) &&
          nonEmptyString(c.name) &&
          (c.provinceCode === null ||
            (nonEmptyString(c.provinceCode) && provinceCodes.has((c.provinceCode as string).trim()))),
      );
      if (cities.length !== data.cities.length) {
        fail('city rows reference unknown provinces or failed shape validation');
      }
      const cityCodes = new Set(cities.map((c) => (c.code as string).trim()));
      const barangays = data.barangays.filter(
        (b) =>
          nonEmptyString(b.code) &&
          nonEmptyString(b.name) &&
          nonEmptyString(b.cityCode) &&
          cityCodes.has((b.cityCode as string).trim()),
      );
      if (barangays.length !== data.barangays.length) {
        fail('barangay rows reference unknown cities or failed shape validation');
      }
      console.log(
        `validated: ${provinces.length} provinces, ${cities.length} cities/municipalities, ${barangays.length} barangays`,
      );
      if (process.argv.includes('--dry-run')) {
        console.log('dry run - no writes performed');
        return;
      }
      const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceKey) fail('missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      const supabase = createClient(supabaseUrl as string, serviceKey as string, {
        auth: { autoRefreshToken: false },
      });
      const upsert = async (table: string, rows: Record<string, unknown>[]) => {
        const CHUNK = 1000;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const { error } = await supabase.from(table).upsert(rows.slice(i, i + CHUNK), {
            onConflict: 'code',
          });
          if (error) fail(`${table} upsert failed: ${error.message}`);
        }
        console.log(`${table}: upserted ${rows.length} rows`);
      };
      await upsert(
        'ph_provinces',
        provinces.map((p) => ({
          code: (p.code as string).trim(),
          name: (p.name as string).trim(),
          region_code: (p.regionCode as string).trim(),
          region_name: (p.regionName as string).trim(),
        })),
      );
      await upsert(
        'ph_cities',
        cities.map((c) => ({
          code: (c.code as string).trim(),
          province_code:
            c.provinceCode === null ? null : (c.provinceCode as string).trim(),
          name: (c.name as string).trim(),
          is_city: c.isCity !== false,
        })),
      );
      await upsert(
        'ph_barangays',
        barangays.map((b) => ({
          code: (b.code as string).trim(),
          city_code: (b.cityCode as string).trim(),
          name: (b.name as string).trim(),
        })),
      );
      console.log('seed-ph-locations: done');
    })
    .catch((e) => fail(e instanceof Error ? e.message : String(e)));
}

main();
