import { expect, it } from 'vitest';
import { cmsContentSchemas } from '@afhomes/contracts';
import { websiteDefaults } from './index';
it('validates every unchanged website default against its canonical schema', () => {
  for (const key of Object.keys(websiteDefaults) as Array<keyof typeof websiteDefaults>) {
    const parsed = cmsContentSchemas[key].safeParse(websiteDefaults[key]);
    expect(parsed.success, key + ': ' + JSON.stringify(parsed.error?.issues)).toBe(true);
  }
});
