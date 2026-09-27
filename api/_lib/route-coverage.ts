import fs from 'node:fs';
import path from 'node:path';

/**
 * Route coverage - prevents silent 404s for new handler files.
 *
 * `api/_lib/router.ts` routes by a hand-maintained if/else chain, so a newly
 * added `api/_handlers/**` handler 404s (`No handler for ...`) until both an
 * import and a branch are added - exactly how `DELETE/PATCH /admin/content/:id`
 * broke after `content/[id].ts` landed without a route. This module scans
 * the handler tree and reports files that are not imported or whose import
 * binding is never used in a branch; the dev server logs them loudly at
 * startup and the spec below fails CI the moment a route is forgotten. Pure
 * functions - no server boot, no network.
 */

const HANDLER_IMPORT_RE = /^import\s+([A-Za-z_$][\w$]*)\s+from\s+'(\.\.\/_handlers\/[^']+)'/gm;
// Only a literal dynamic import is deployable. Merely storing a handler path in
// a data object and later calling import(variable) looks routed in source but is
// invisible to Vercel's dependency tracer.
const HANDLER_DYNAMIC_RE = /import\(\s*'(\.\.\/_handlers\/[^']+)'\s*\)/g;

export type RouteCoverageGapReason = 'not-imported' | 'imported-but-unused';

export interface RouteCoverageGap {
  /** Handler path relative to `api/`, e.g. `_handlers/admin/content/[id].ts`. */
  file: string;
  reason: RouteCoverageGapReason;
}

/** Handler files under a `v1/` dir: `.ts` except `*.spec.ts` and `_`-prefixed shared modules. */
export function listHandlerFiles(v1Dir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.startsWith('_')
      ) {
        out.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(v1Dir, '');
  return out.sort();
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Files in `handlersDir` missing from `routerSource`: not imported at all, or
 * imported but never referenced in a routing branch (declaration alone does
 * not serve traffic). Empty = fully covered.
 */
export function findRouteCoverageGaps(
  handlersDir: string,
  routerSource: string,
): RouteCoverageGap[] {
  const imports = new Map<string, string>();
  for (const match of routerSource.matchAll(HANDLER_IMPORT_RE)) {
    imports.set(match[2]!, match[1]!);
  }
  // Lazy-load branches (`lazy(() => import('../_handlers/...'))`) count as
  // both the import and the usage - no binding to check.
  const dynamic = new Set<string>();
  for (const match of routerSource.matchAll(HANDLER_DYNAMIC_RE)) {
    dynamic.add(match[1]!);
  }
  const gaps: RouteCoverageGap[] = [];
  for (const file of listHandlerFiles(handlersDir)) {
    const noExt = file.replace(/\.ts$/, '');
    const hit = [`../_handlers/${noExt}.js`, `../_handlers/${noExt}`].find((spec) =>
      imports.has(spec),
    );
    if (!hit) {
      const dynamicHit = [`../_handlers/${noExt}.js`, `../_handlers/${noExt}`].some((spec) =>
        dynamic.has(spec),
      );
      if (!dynamicHit) gaps.push({ file: `_handlers/${file}`, reason: 'not-imported' });
      continue;
    }
    const binding = imports.get(hit)!;
    const uses = routerSource.match(new RegExp(`\\b${escapeRegExp(binding)}\\b`, 'g')) ?? [];
    if (uses.length < 2) {
      gaps.push({ file: `_handlers/${file}`, reason: 'imported-but-unused' });
    }
  }
  return gaps;
}
