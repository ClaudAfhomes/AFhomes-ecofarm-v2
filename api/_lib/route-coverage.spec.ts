import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { findRouteCoverageGaps, listHandlerFiles } from './route-coverage.js';

const SOURCE = `import handlerA from '../_handlers/a.js';
import handlerB from '../_handlers/admin/b/[id].js';
import handlerUnused from '../_handlers/unused.js';

const handlerC = lazy(() => import('../_handlers/c.js'));

if (x) {
  handler = handlerA;
} else if (y) {
  handler = handlerB;
}
`;

describe('findRouteCoverageGaps (fixture source)', () => {
  it('flags missing imports and imported-but-unused bindings; accepts lazy loads', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'));
    fs.writeFileSync(path.join(dir, 'a.ts'), 'x');
    fs.mkdirSync(path.join(dir, 'admin', 'b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'admin', 'b', '[id].ts'), 'x');
    fs.writeFileSync(path.join(dir, 'c.ts'), 'x');
    fs.writeFileSync(path.join(dir, 'orphan.ts'), 'x');
    fs.writeFileSync(path.join(dir, 'unused.ts'), 'x');
    expect(findRouteCoverageGaps(dir, SOURCE)).toEqual([
      { file: '_handlers/orphan.ts', reason: 'not-imported' },
      { file: '_handlers/unused.ts', reason: 'imported-but-unused' },
    ]);
  });

  it('rejects a quoted handler path that is imported through a variable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'));
    fs.writeFileSync(path.join(dir, 'a.ts'), 'x');
    const source = `const route = { handler: '../_handlers/a.js' };\nimport(route.handler);`;
    expect(findRouteCoverageGaps(dir, source)).toEqual([
      { file: '_handlers/a.ts', reason: 'not-imported' },
    ]);
  });
});

describe('listHandlerFiles', () => {
  it('skips specs and underscore-prefixed shared modules', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'));
    fs.writeFileSync(path.join(dir, 'a.ts'), 'x');
    fs.writeFileSync(path.join(dir, 'a.spec.ts'), 'x');
    fs.writeFileSync(path.join(dir, '_shared.ts'), 'x');
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nested', '[id].ts'), 'x');
    expect(listHandlerFiles(dir)).toEqual(['a.ts', 'nested/[id].ts']);
  });
});

describe('live handler tree vs router route table (regression guard)', () => {
  it('every handler file is imported and routed', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const apiDir = path.resolve(here, '..');
    const gaps = findRouteCoverageGaps(
      path.join(apiDir, '_handlers'),
      fs.readFileSync(path.join(apiDir, '_lib', 'router.ts'), 'utf8'),
    );
    expect(gaps).toEqual([]);
  });
});
