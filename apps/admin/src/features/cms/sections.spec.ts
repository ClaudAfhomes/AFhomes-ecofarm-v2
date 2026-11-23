import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cmsSections, filterSections } from './sections';

const schema = z.object({
  email: z.string(),
  footerTitle: z.string(),
  offices: z.array(z.object({ city: z.string(), id: z.string() })),
  nav: z.object({ main: z.array(z.object({ label: z.string() })) }),
});

describe('cmsSections', () => {
  it('groups loose fields as General details and lists nested groups', () => {
    const sections = cmsSections(schema, {}, 'site');
    expect(sections.map((s) => [s.id, s.label])).toEqual([
      ['cms-site', 'General details'],
      ['cms-site-offices', 'Offices'],
      ['cms-site-nav', 'Nav'],
    ]);
    expect(sections[0]!.fieldLabels).toEqual(['Email', 'Footer Title']);
    expect(sections[1]!.fieldLabels).toContain('City');
    expect(sections[1]!.fieldLabels).not.toContain('Id');
  });
  it('lists entries for a list document', () => {
    const list = z.array(z.object({ title: z.string() }));
    expect(
      cmsSections(list, [{ title: 'Harvest' }, {}], 'stories').map((s) => [s.id, s.label]),
    ).toEqual([
      ['cms-stories-0', 'Harvest'],
      ['cms-stories-1', 'Entry 2'],
    ]);
  });
  it('filters by section or field label, case-insensitively', () => {
    const sections = cmsSections(schema, {}, 'site');
    expect(filterSections(sections, 'FOOTER').map((s) => s.label)).toEqual(['General details']);
    expect(filterSections(sections, 'city').map((s) => s.label)).toEqual(['Offices']);
    expect(filterSections(sections, '  ')).toHaveLength(3);
  });
});
