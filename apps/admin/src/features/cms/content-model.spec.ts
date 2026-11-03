import { expect, it } from 'vitest';
import { cmsContentSchemas } from '@afhomes/contracts';
import { initialCmsValue, cmsDisplayState, cmsEditableFields } from './content-model';
it('preserves an invalid saved draft instead of replacing it with defaults', () => {
  const draft={unknown:'preserve'};
  expect(initialCmsValue({draftValue:draft,publishedValue:[]} as never,'stories')).toEqual(draft);
});
it('uses published content before defaults and separates changes from publication state', () => {
  expect(initialCmsValue({draftValue:undefined,publishedValue:[]} as never,'stories')).toEqual([]);
  expect(cmsDisplayState({status:'published',draftValue:[1],publishedValue:[2]} as never)).toBe('Unpublished Changes');
});
it('does not offer operational VIP fields or technical styling as editable fields', () => {
  expect(cmsEditableFields('vip')).not.toContain('discountPercent');
  expect(cmsContentSchemas.stories.safeParse([]).success).toBe(true);
});
