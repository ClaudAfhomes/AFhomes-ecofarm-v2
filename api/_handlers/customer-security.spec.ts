/**
 * Repo-wide tripwires for the Phase 3 customer portal.
 *
 * These are the invariants that are cheap to state and expensive to lose. Each
 * one has already been violated at least once during development, which is
 * exactly why it is worth pinning.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.sql', '.mjs', '.cjs', '.json', '.css']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.tmp-bin', 'vercel-static', 'coverage']);

/** Every source file in the repo, minus build output and dependencies. */
function sourceFiles(dir = REPO, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      sourceFiles(full, out);
    } else if (SCANNED_EXTENSIONS.has(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles();
const read = (file: string) => readFileSync(file, 'utf8');
const rel = (file: string) => relative(REPO, file).replace(/\\/g, '/');

/** Strip comments, so prose that NAMES a forbidden thing to forbid it is not
 *  mistaken for code that uses it. */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');

const readCode = (file: string) => stripComments(read(file));

/** Files that legitimately mention the forbidden terms in order to forbid them. */
const isGuard = (file: string) => {
  const p = rel(file);
  return (
    p.includes('.spec.') ||
    p.endsWith('supabase-shim.sql') ||
    p === 'supabase/db-integration.ts' ||
    p === 'api/_handlers/phase3-migration.spec.ts'
  );
};

describe('no NFC, anywhere, ever', () => {
  // CODE is scanned, not prose. A comment saying "NO NFC here" documents an
  // absence and must not trip the guard that enforces it - otherwise the only
  // way to satisfy the tripwire is to stop documenting the decision. This guard
  // fired on exactly that case once, which is how the distinction was made.
  const offenders: string[] = [];
  for (const file of FILES) {
    if (isGuard(file)) continue;
    const hits = readCode(file).match(
      /(?<![\w])(?:nfc|ndef|tagid|tag_id)(?![\w])|nfc_|card[ _-]?reader|emulate[sd]?[ _-]?tag/gi,
    );
    if (hits) offenders.push(`${rel(file)}: ${[...new Set(hits)].join(', ')}`);
  }

  it('finds no NFC column, tag id, NDEF record or card-reader concept in any source file', () => {
    expect(offenders).toEqual([]);
  });

  it('adds no NFC dependency', () => {
    const manifests = FILES.filter((f) => f.endsWith('package.json'));
    const bad = manifests.filter((f) => /(nfc|tag|ndef)/i.test(read(f)));
    expect(bad.map(rel)).toEqual([]);
  });

  it('proves the guard is live rather than vacuously passing', () => {
    // A guard that can never fail is worse than no guard. Feed it the one thing
    // it exists to catch and confirm it is detected.
    const planted = `const tag = 'nfc';\nconst x = tagId;`;
    const detected = /(?<![\w])(?:nfc|ndef|tagid|tag_id)(?![\w])|nfc_|card[ _-]?reader/gi.test(planted);
    expect(detected).toBe(true);
  });
});

describe('the browser bundle cannot reach a server-only secret', () => {
  it('no app source references the service role or a server-only variable', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const p = rel(file);
      if (!p.startsWith('apps/')) continue;
      if (p.includes('.spec.')) continue;
      const hits = read(file).match(
        /SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|serviceClient|\bDATABASE_URL\b|service_role/gi,
      );
      if (hits) offenders.push(`${p}: ${[...new Set(hits)].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the customer portal never imports the staff authorization resolver', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const p = rel(file);
      if (!p.startsWith('apps/web/src/features/customer/')) continue;
      if (p.includes('.spec.')) continue;
      if (/afhomes-access|has_permission|role_permissions|staff_role_assignments/.test(read(file))) {
        offenders.push(p);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the customer principal resolver consults no staff table', () => {
    const source = readCode(join(REPO, 'api/_lib/customer-access.ts'));
    for (const forbidden of [
      'staff_users',
      'staff_role_assignments',
      'role_permissions',
      'staff_permission_restrictions',
      'has_permission',
      'authorizeAfHomes',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

describe('no plaintext secret handling', () => {
  it('the activation handler never logs, returns or stores a password or token', () => {
    const source = readCode(join(REPO, 'api/_handlers/customer-activation.ts'));
    // `password` legitimately appears in the createUser call and in comments.
    // What must not appear is any sink that could persist or disclose it.
    for (const sink of [
      /console\.(log|error|warn|info|debug)\([^)]*password/i,
      /console\.(log|error|warn|info|debug)\([^)]*token/i,
      /insert into[\s\S]{0,80}password/i,
      /password:\s*password\b/,
      /JSON\.stringify\([^)]*onboardingToken/,
    ] as const) {
      expect(source, sink.source).not.toMatch(sink);
    }
    // And it must never return a session-shaped payload.
    expect(source).not.toMatch(/access_token|refresh_token|\bjwt\b/i);
  });

  it('the portal handler never selects a credential hash, a government ID or an actor id', () => {
    const source = readCode(join(REPO, 'api/_handlers/customer-portal.ts'));
    const selects = [...source.matchAll(/\.select\(([^)]*)\)/g)].flatMap((m) =>
      (m[1] ?? '').split(',').map((s) => s.trim()),
    );
    for (const forbidden of [
      'government_id_number',
      'government_id_type',
      'fallback_code_hash',
      'qr_token_hash',
      'activated_by',
      'actor_id',
      'metadata',
      '*',
    ]) {
      expect(selects, forbidden).not.toContain(forbidden);
    }
  });

  it('no test or source file contains a real-looking credential', () => {
    // A structural guard, not a scanner: this repo must never gain a committed
    // service key or connection string.
    //
    // The two allowlisted files are reviewed, and the reason is recorded here so
    // the next reader checks rather than widens the pattern:
    //   packages/config/src/env.spec.ts  - an obvious dummy fixture
    //     (`user:pass@pooler`) proving the env parser rejects/keeps a value. Not
    //     a credential for anything.
    //   scripts/lib/local-postgres.mjs   - the DISPOSABLE loopback test server's
    //     own URL, built from a hardcoded throwaway password for a database that
    //     is created and deleted inside the test run. It is 127.0.0.1 and it
    //     grants nothing.
    const ALLOWED = new Set([
      'packages/config/src/env.spec.ts',
      'scripts/lib/local-postgres.mjs',
    ]);
    const offenders: string[] = [];
    for (const file of FILES) {
      const p = rel(file);
      if (p.startsWith('docs/') || ALLOWED.has(p)) continue;
      const hits = read(file).match(
        /(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})|(?:postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@)/g,
      );
      if (hits) offenders.push(`${p}: ${hits.length} match(es)`);
    }
    expect(offenders).toEqual([]);
  });
});
