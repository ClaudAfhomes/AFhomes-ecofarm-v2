import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runtime asset resolution for workbook templates and reference data.
 *
 * Source checkouts read the assets from `packages/contracts/assets`. A bundled
 * production artifact (see `api/scripts/build-api.mjs`) ships them next to
 * `server.js` as `assets/`. `AFHOMES_ASSET_ROOT` is an explicit operator
 * override for installations that keep assets outside the release directory.
 */
function assetRoots(): string[] {
  const configured = process.env.AFHOMES_ASSET_ROOT?.trim();
  return [
    ...(configured ? [path.resolve(configured)] : []),
    fileURLToPath(new URL('../../packages/contracts/assets/', import.meta.url)),
    fileURLToPath(new URL('./assets/', import.meta.url)),
  ];
}

export function readRuntimeAsset(relative: string): Buffer {
  if (
    !relative ||
    relative.startsWith('/') ||
    relative.includes('\\') ||
    relative.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid runtime asset path');
  for (const root of assetRoots()) {
    const file = path.join(root, relative);
    if (existsSync(file)) return readFileSync(file);
  }
  throw new Error(`Runtime asset is unavailable: ${relative}`);
}

export function readRuntimeTextAsset(relative: string): string {
  return readRuntimeAsset(relative).toString('utf8');
}
