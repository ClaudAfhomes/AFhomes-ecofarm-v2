import { describe, expect, it } from 'vitest';
import { cmsContentSchemas } from '@afhomes/contracts';
import {
  initialCmsValue,
  cmsDisplayState,
  cmsEditableFields,
  cmsFieldId,
  summarizeChanges,
} from './content-model';
it('preserves an invalid saved draft instead of replacing it with defaults', () => {
  const draft = { unknown: 'preserve' };
  expect(initialCmsValue({ draftValue: draft, publishedValue: [] } as never, 'stories')).toEqual(
    draft,
  );
});
it('uses published content before defaults and separates changes from publication state', () => {
  expect(
    initialCmsValue({ draftValue: undefined, publishedValue: [] } as never, 'stories'),
  ).toEqual([]);
  expect(
    cmsDisplayState({ status: 'published', draftValue: [1], publishedValue: [2] } as never),
  ).toBe('Unpublished Changes');
});
it('does not offer operational VIP fields or technical styling as editable fields', () => {
  expect(cmsEditableFields('vip')).not.toContain('discountPercent');
  expect(cmsContentSchemas.stories.safeParse([]).success).toBe(true);
});
describe('summarizeChanges', () => {
  it('returns nothing when nothing changed', () => {
    expect(summarizeChanges({ a: 1 }, { a: 1 })).toBe('');
  });
  it('names the changed fields in plain words', () => {
    expect(
      summarizeChanges(
        { footerTitle: 'A', theme: undefined },
        { footerTitle: 'B', theme: { primary: '#000000' } },
      ),
    ).toBe('Updated Footer Title, Theme');
  });
  it('caps the list and counts the rest', () => {
    const before = { a: 1, b: 1, c: 1, d: 1, e: 1 };
    expect(summarizeChanges(before, { a: 2, b: 2, c: 2, d: 2, e: 2 })).toBe(
      'Updated A, B, C and 2 more',
    );
  });
  it('describes list edits by entry', () => {
    expect(summarizeChanges([], [{ title: 'Harvest' }])).toBe('Added 1 entry');
    expect(summarizeChanges([{ title: 'A' }, { title: 'B' }], [])).toBe('Removed 2 entries');
    expect(summarizeChanges([{ title: 'A' }], [{ title: 'A2' }])).toBe('Updated A2');
  });
});
it('builds stable DOM ids from field paths', () => {
  expect(cmsFieldId('site.theme')).toBe('cms-site-theme');
  expect(cmsFieldId('stories.0')).toBe('cms-stories-0');
});
