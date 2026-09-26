/**
 * Shared Supabase env resolution for api/ handlers (server-only).
 * Resolution order: explicit SUPABASE_URL, then VITE_SUPABASE_URL (so one
 * local .env serves both the apps and the API), then derived from DATABASE_URL.
 * Never commit secrets - all values come from process env.
 */
export function getSupabaseEnv() {
  let url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  // Fallback: derive from DATABASE_URL like supabase/seed.ts does (for local .env without VITE_ URL).
  // Note: the project ref is the label after an optional `db.` prefix
  // (real DATABASE_URL hosts look like `db.<ref>.supabase.co`).
  if ((!url || url.includes('your-project')) && process.env.DATABASE_URL) {
    try {
      const dbUrl = new URL(process.env.DATABASE_URL);
      const ref = dbUrl.hostname.replace(/^db\./, '').split('.')[0];
      if (ref) url = `https://${ref}.supabase.co`;
    } catch {}
  }
  // A placeholder/unset URL must fail loudly, never silently route to a real
  // project (a hardcoded project ref here would combine whatever service key
  // is configured with the wrong tenant).
  if (url?.includes('your-project')) url = undefined;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  // Trim: a trailing newline/space pasted into a host env var would otherwise
  // produce an invalid `apikey`/token and silently fail auth or DB access.
  return {
    url: url?.trim() || undefined,
    serviceKey: serviceKey?.trim() || undefined,
    anonKey: anonKey?.trim() || undefined,
  };
}
