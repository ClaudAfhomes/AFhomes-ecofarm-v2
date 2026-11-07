import { expect, it } from 'vitest';
import { cmsContentSchemas, cmsVersionRequestSchema } from './cms-content';

it('accepts empty lists, optional story flags and validates full story content', () => {
  expect(cmsContentSchemas.stories.safeParse([]).success).toBe(true);
  expect(cmsContentSchemas.stories.safeParse([{id:'story-one',slug:'story-one',title:'A visit',category:'News',date:'2026-10-24',excerpt:'A short visit.',content:[],cover:{src:'/images/visit.jpg',alt:'A visit'}}]).success).toBe(true);
});
it('rejects incomplete shapes and executable or network-relative media URLs', () => {
  for (const src of ['javascript:alert(1)', '//evil.invalid/image.jpg', 'data:text/html,test']) {
    expect(cmsContentSchemas.stories.safeParse([{id:'one',slug:'one',title:'A',category:'News',date:'2026-10-24',excerpt:'A',content:[],cover:{src,alt:'A'}}]).success).toBe(false);
  }
  expect(cmsContentSchemas.pageContent.safeParse({home:{heroTitle:'Only one field'}}).success).toBe(false);
});
it('requires a positive saved version for publish and restore', () => {
  expect(cmsVersionRequestSchema.safeParse({}).success).toBe(false);
  expect(cmsVersionRequestSchema.safeParse({expectedVersion:2}).success).toBe(true);
});
