/**
 * Environment isolation guard.
 *
 * The rule is directional:
 *  - Browser code (anything bundled into an SPA) may read ONLY `import.meta.env`
 *    values that are `VITE_`-prefixed (plus Vite's own `DEV`/`PROD`/`MODE`/
 *    `BASE_URL`/`SSR` flags), and must never touch `process.env`.
 *  - Server code (api/, supabase/) legitimately reads server-only variables
 *    from `process.env`, and must never read `import.meta.env` (a browser API).
 *
 * Complements - does not replace - a secret scan: this checks the code's intent,
 * the scan checks the artifact.
 *
 * Usage:
 *   pnpm check:env            # source scan
 *   pnpm check:env -- --built # also scan built assets for server-only names
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

/** Never readable by a browser, never `VITE_`-prefixed, never inlined by Vite. */
const SERVER_ONLY = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY',
  'DATABASE_URL',
  'AFHOMES_TARGET_PROJECT_REF',
  'AFHOMES_SUPERADMIN_EMAIL',
  'AFHOMES_WEB_URL',
  'AFHOMES_ADMIN_URL',
  'EMAIL_FROM',
  'RESEND_API_KEY',
  'DOCUMENT_HASH_PEPPER',
  'OCR_PROVIDER_URL',
  'OCR_PROVIDER_API_KEY',
];

/** Vite-provided `import.meta.env` flags that are safe in browser code. */
const VITE_BUILTINS = new Set(['DEV', 'PROD', 'MODE', 'BASE_URL', 'SSR']);

/** Directories whose source is bundled into a browser artifact. */
const BROWSER_ROOTS = ['apps/web/src', 'apps/admin/src', 'packages'];
/** Directories that run on the server, where `process.env` is correct. */
const SERVER_ROOTS = ['api', 'supabase'];

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|css)$/;
const BUILT_EXT = /\.(js|css|html)$/;
const SKIP_DIR = /node_modules|\.turbo|\.git/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.test(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

const violations = [];
let browserFiles = 0;
let serverFiles = 0;

function linesOf(file) {
  return readFileSync(file, 'utf8').split('\n');
}

/* ---- browser code: VITE_ only, never process.env ---- */
for (const root of BROWSER_ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    if (!SOURCE_EXT.test(file)) continue;
    browserFiles += 1;
    const rel = relative(ROOT, file);
    linesOf(file).forEach((line, i) => {
      if (/\bprocess\.env\b/.test(line)) {
        violations.push({ file: rel, line: i + 1, detail: 'process.env used in browser code' });
      }
      const access = /import\.meta\.env\.([A-Za-z0-9_]+)/g;
      let m;
      while ((m = access.exec(line)) !== null) {
        const name = m[1];
        if (!name.startsWith('VITE_') && !VITE_BUILTINS.has(name)) {
          violations.push({ file: rel, line: i + 1, detail: `import.meta.env.${name} is not VITE_-prefixed` });
        }
      }
      // Destructuring a whole env object would bypass the checks above. The one
      // sanctioned shape is handing the raw object to the typed loader, which
      // parses it through a VITE_-only Zod object (unknown keys are stripped) -
      // pinned by `packages/config/src/env.spec.ts`.
      if (
        /import\.meta\.env\s*[,;)\]]/.test(line) ||
        /\{\s*env\s*\}\s*=\s*import\.meta/.test(line)
      ) {
        const sanctioned = /loadPublicEnv\(\s*import\.meta\.env\s*\)/.test(line);
        if (!sanctioned) {
          violations.push({ file: rel, line: i + 1, detail: 'whole import.meta.env object used' });
        }
      }
    });
  }
}

/* ---- server code: process.env yes, import.meta.env no ---- */
for (const root of SERVER_ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    if (!SOURCE_EXT.test(file)) continue;
    serverFiles += 1;
    const rel = relative(ROOT, file);
    linesOf(file).forEach((line, i) => {
      if (/import\.meta\.env/.test(line)) {
        violations.push({ file: rel, line: i + 1, detail: 'import.meta.env used in server code' });
      }
    });
  }
}

/* ---- built assets must not reference a server-only name ---- */
if (process.argv.includes('--built')) {
  for (const dir of ['vercel-static', 'apps/web/dist', 'apps/admin/dist']) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      if (!BUILT_EXT.test(file)) continue;
      const src = readFileSync(file, 'utf8');
      for (const name of SERVER_ONLY) {
        if (src.includes(`process.env.${name}`) || src.includes(`import.meta.env.${name}`)) {
          violations.push({
            file: relative(ROOT, file),
            line: 0,
            detail: `built asset references server-only ${name}`,
          });
        }
      }
    }
  }
}

console.log(
  `[check:env] scanned ${browserFiles} browser source file(s) and ${serverFiles} server source file(s).`,
);
if (violations.length === 0) {
  console.log('[check:env] PASS - browser code cannot observe any server-only variable.');
  process.exit(0);
}
console.error(`[check:env] FAIL - ${violations.length} violation(s):`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.detail}`);
}
process.exit(1);
