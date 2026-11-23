import { afterEach, expect, it } from 'vitest';
import * as root from './index.js';
import * as startup from '@afhomes/shared/features';

afterEach(() => root.setFeatureFlags(root.DEFAULT_FEATURE_FLAGS));

it('shares the same live module switches across both package entry points', () => {
  root.setFeatureFlags({ reports: false });
  expect(startup.isFeaturePathEnabled('/api/v1/reports/sales')).toBe(false);
  startup.setFeatureFlags({ reports: true });
  expect(root.FEATURE_FLAGS.reports).toBe(true);
  expect(startup.FEATURE_FLAGS).toBe(root.FEATURE_FLAGS);
});
