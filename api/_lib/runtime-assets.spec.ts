import { describe, expect, it } from 'vitest';
import { readRuntimeAsset, readRuntimeTextAsset } from './runtime-assets.js';

describe('runtime assets', () => {
  it('reads the versioned workbook and postal references from the checkout', () => {
    const workbook = readRuntimeAsset('customer-company-template.xlsx');
    expect(workbook.subarray(0, 2).toString('hex')).toBe('504b');
    const postal = JSON.parse(readRuntimeTextAsset('postal/national-reference.json'));
    expect(Array.isArray(postal)).toBe(true);
    expect(postal.length).toBeGreaterThan(100);
  });

  it('refuses traversal and absolute paths', () => {
    for (const path of ['../secret', '/etc/passwd', 'postal/../../secret', 'a//b', 'a\\\\b'])
      expect(() => readRuntimeAsset(path)).toThrow('Invalid runtime asset path');
  });

  it('fails closed for an asset that is not shipped', () => {
    expect(() => readRuntimeAsset('missing-template.xlsx')).toThrow(
      'Runtime asset is unavailable',
    );
  });
});
