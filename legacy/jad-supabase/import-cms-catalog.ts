/**
 * One-time catalog backfill from live Website CMS data (Phase B follow-up).
 *
 * Context: the seed purge deleted every `PropertyCategory` / `Property`
 * row while `cms_contents.properties` (the preserved core) kept the live
 * categories + listings. `GET /admin/properties` reads the `Property` table
 * only, and `GET /admin/property-categories` renders DB keys merged with CMS
 * presentation - so both admin/properties tabs read 0/0 despite healthy CMS
 * JSON. This script re-inserts the missing DB keys FROM the live CMS JSON
 * (never the reverse; CMS content is untouched).
 *
 * Mapping (DB key columns only - presentation stays in JSON):
 *   CMS category {slug, title}            -> PropertyCategory{slug, title}
 *   CMS property {id, name, categoryId}   -> Property{id, name, categorySlug}
 *   CMS price kept only when exact-decimal (^\d+(\.\d{1,2})?$), else null
 *   CMS status                            -> 'ACTIVE' (catalog default)
 *
 * Skipped with warnings (never invented): properties whose categoryId has no
 * matching category; rows failing the id/category slug shape.
 *
 * Idempotent: plain upserts on slug/id; safe to re-run.
 *
 * Safety model (fail-closed, same as the other supabase scripts):
 * - Default mode is DRY-RUN: SELECTs only, changes nothing. Prints the
 *   planned inserts/skips for approval.
 * - `--execute` additionally requires the target project ref in
 *   `DEV_RESET_ALLOW_REFS`. Anything else aborts.
 *
 * Usage:
 *   pnpm exec tsx supabase/import-cms-catalog.ts                                     # dry-run
 *   DEV_RESET_ALLOW_REFS=<ref> pnpm exec tsx supabase/import-cms-catalog.ts --execute
 */

import fs from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function loadEnvFile(path: string): void {
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
  } catch {
    // missing file - fall through to whatever the environment provides
  }
}

loadEnvFile('.env');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXACT_DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

export function projectRefFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.split('.')[0] ?? '';
  } catch {
    return '';
  }
}

function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env).');
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false } });
}

type CmsCategory = { slug?: unknown; title?: unknown };
type CmsProperty = {
  id?: unknown;
  name?: unknown;
  categoryId?: unknown;
  price?: unknown;
};

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const mode = args.has('--execute') ? 'execute' : 'dry-run';

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  const ref = projectRefFromUrl(supabaseUrl);
  if (!ref || ref.includes('your-project')) {
    console.error('Could not resolve a Supabase project ref. Aborting.');
    process.exit(1);
  }
  console.log(`Target project ref: ${ref}`);
  console.log(`Mode: ${mode}`);

  const supabase = serviceClient();
  const { data: cmsRow, error: cmsError } = await supabase
    .from('cms_contents')
    .select('content')
    .eq('key', 'properties')
    .maybeSingle();
  if (cmsError || !cmsRow) {
    console.error(
      `Live CMS 'properties' content unreadable: ${cmsError?.message ?? 'missing row'}`,
    );
    process.exit(1);
  }
  const content = ((cmsRow as { content?: unknown }).content ?? {}) as {
    categories?: unknown;
    properties?: unknown;
  };
  const cmsCategories = (
    Array.isArray(content.categories) ? content.categories : []
  ) as CmsCategory[];
  const cmsProperties = (
    Array.isArray(content.properties) ? content.properties : []
  ) as CmsProperty[];
  console.log(
    `Live CMS entries: ${cmsCategories.length} categories, ${cmsProperties.length} properties`,
  );

  // Plan category upserts (FK targets first).
  const categoryUpserts: { slug: string; title: string }[] = [];
  const categorySkips: string[] = [];
  for (const c of cmsCategories) {
    const slug = typeof c.slug === 'string' ? c.slug : '';
    const title = typeof c.title === 'string' && c.title.trim() ? c.title.trim() : '';
    if (!SLUG_RE.test(slug) || slug.length > 60 || !title) {
      categorySkips.push(`category slug=${JSON.stringify(c.slug)} (invalid slug/title)`);
      continue;
    }
    categoryUpserts.push({ slug, title });
  }
  const knownSlugs = new Set(categoryUpserts.map((c) => c.slug));

  // Plan property upserts (category must exist; price only when exact-decimal).
  const propertyUpserts: {
    id: string;
    name: string;
    categorySlug: string;
    price: string | null;
    status: string;
  }[] = [];
  const propertySkips: string[] = [];
  const priceWarnings: string[] = [];
  for (const p of cmsProperties) {
    const id = typeof p.id === 'string' ? p.id : '';
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '';
    const categoryId = typeof p.categoryId === 'string' ? p.categoryId : '';
    if (!SLUG_RE.test(id) || id.length > 60 || !name || !SLUG_RE.test(categoryId)) {
      propertySkips.push(`property id=${JSON.stringify(p.id)} (invalid id/name/category)`);
      continue;
    }
    if (!knownSlugs.has(categoryId)) {
      propertySkips.push(`property id=${id} (unknown category ${categoryId})`);
      continue;
    }
    let price: string | null = null;
    if (typeof p.price === 'string' && p.price.trim() !== '') {
      if (EXACT_DECIMAL_RE.test(p.price.trim())) price = p.price.trim();
      else priceWarnings.push(`property id=${id} (price ${JSON.stringify(p.price)} kept as null)`);
    }
    propertyUpserts.push({ id, name, categorySlug: categoryId, price, status: 'ACTIVE' });
  }

  // Current DB state (read-only).
  const { count: liveCategories } = await supabase
    .from('PropertyCategory')
    .select('*', { count: 'exact', head: true });
  const { count: liveProperties } = await supabase
    .from('Property')
    .select('*', { count: 'exact', head: true });
  console.log(
    `Live DB rows: PropertyCategory=${liveCategories ?? 0}, Property=${liveProperties ?? 0}`,
  );

  console.log(`\nPlanned category upserts (${categoryUpserts.length}):`);
  for (const c of categoryUpserts) console.log(`  + ${c.slug} - ${c.title}`);
  for (const s of categorySkips) console.log(`  SKIP ${s}`);
  console.log(`Planned property upserts (${propertyUpserts.length}):`);
  for (const p of propertyUpserts) {
    console.log(`  + ${p.id} - ${p.name} [${p.categorySlug}] price=${p.price ?? '(null)'}`);
  }
  for (const s of propertySkips) console.log(`  SKIP ${s}`);
  for (const w of priceWarnings) console.log(`  WARN ${w}`);

  if (mode === 'dry-run') {
    console.log(
      '\nDRY-RUN - no changes made. Re-run with --execute plus DEV_RESET_ALLOW_REFS=' + ref,
    );
    return;
  }

  const allowed = (process.env.DEV_RESET_ALLOW_REFS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(ref)) {
    console.error(
      `Refusing: project ref "${ref}" is not listed in DEV_RESET_ALLOW_REFS. Aborting with no changes.`,
    );
    process.exit(1);
  }

  for (const c of categoryUpserts) {
    const { error } = await supabase.from('PropertyCategory').upsert(c, { onConflict: 'slug' });
    if (error) {
      console.error(`Category upsert ${c.slug} failed: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`Categories ready (${categoryUpserts.length})`);
  for (const p of propertyUpserts) {
    const { error } = await supabase.from('Property').upsert(p, { onConflict: 'id' });
    if (error) {
      console.error(`Property upsert ${p.id} failed: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`Properties ready (${propertyUpserts.length})`);

  const { count: afterCategories } = await supabase
    .from('PropertyCategory')
    .select('*', { count: 'exact', head: true });
  const { count: afterProperties } = await supabase
    .from('Property')
    .select('*', { count: 'exact', head: true });
  console.log(
    `Verified: PropertyCategory=${afterCategories ?? 0}, Property=${afterProperties ?? 0}`,
  );
  if (
    (afterCategories ?? 0) < categoryUpserts.length ||
    (afterProperties ?? 0) < propertyUpserts.length
  ) {
    console.error('Verification FAILED - inspect output above.');
    process.exit(2);
  }
  console.log(
    'Import complete. Next: reload /admin/properties and run `supabase/security/rls_invariants.sql` (empty = PASS).',
  );
}

void main().catch((err: unknown) => {
  console.error('import-cms-catalog failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
