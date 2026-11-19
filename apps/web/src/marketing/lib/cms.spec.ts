import { describe, expect, it } from 'vitest';
import { safeOverride } from './cms';

describe('Phase 6 CMS public fallback', () => {
  const fallback = {
    title: 'Repository title',
    nested: { enabled: true },
    items: [{ slug: 'one' }],
  };

  it('keeps repository content when a published CMS document is malformed', () => {
    expect(safeOverride({ title: 42 }, fallback)).toBe(fallback);
    expect(safeOverride(null, fallback)).toBe(fallback);
  });

  it('accepts a structurally compatible published override', () => {
    const published = { title: 'CMS title', nested: { enabled: false }, items: [{ slug: 'two' }] };
    expect(safeOverride(published, fallback)).toBe(published);
  });

  it('allows an intentionally empty published collection', () => {
    expect(safeOverride([], fallback.items)).toEqual([]);
  });
});
