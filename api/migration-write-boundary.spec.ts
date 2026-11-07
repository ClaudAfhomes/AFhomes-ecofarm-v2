import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(args: string[]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afhomes-migration-boundary-'));
  const preload = path.join(directory, 'no-network.cjs');
  fs.writeFileSync(
    preload,
    [
      'const pg=require(' + JSON.stringify(path.join(root, 'node_modules/pg')) + ');',
      'pg.Client=class {async connect() {} async end() {} async query(sql) {',
      "if(!/^select\\b/i.test(sql.trim())) throw Error('UNEXPECTED_DATABASE_WRITE');",
      "if(sql.includes('to_regclass')) return {rows:[{relation:'supabase_migrations.schema_migrations'}]};",
      'return {rows:[],rowCount:0};}};',
    ].join('\n'),
  );
  try {
    const out = execFileSync(
      'node',
      [
        '--require',
        preload,
        '--import',
        'tsx',
        path.join(root, 'supabase/apply-migrations.ts'),
        ...args,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          AFHOMES_TARGET_PROJECT_REF: 'ikaevepedpqygdlipsei',
          DATABASE_URL: 'postgresql://db.ikaevepedpqygdlipsei.supabase.co/postgres',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { status: 0, out };
  } catch (error) {
    const result = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: result.status ?? 1,
      out: String(result.stdout ?? '') + String(result.stderr ?? ''),
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
describe('migration CLI database write boundary', () => {
  it('exact-version check runs SELECTs only', () => {
    const result = run(['--check', '--only=20261104000001']);
    expect(result.status).toBe(0);
    expect(result.out).toContain('Read-only');
    expect(result.out).not.toContain('UNEXPECTED_DATABASE_WRITE');
  });
  it('ordinary apply refuses the pending legacy reset before the first DDL', () => {
    const result = run(['--approve-production']);
    expect(result.status).not.toBe(0);
    expect(result.out).toContain('LEGACY_POINTS_PRESERVATION_REQUIRED');
    expect(result.out).not.toContain('UNEXPECTED_DATABASE_WRITE');
  });
});
