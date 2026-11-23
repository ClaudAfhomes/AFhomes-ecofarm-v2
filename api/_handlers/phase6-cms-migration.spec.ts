import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.resolve(here, '../../supabase/migrations/20261001000001_afhomes_phase6_cms_foundation.sql'),
  'utf8',
);

describe('Phase 6 CMS migration', () => {
  it('adds only the four explicit CMS modules without granting a baseline role', () => {
    for (const key of ['cms.pages', 'cms.media', 'cms.settings', 'cms.history']) {
      expect(migration).toContain(`('${key}'`);
    }
    expect(migration).not.toMatch(/insert into public\.role_permissions/i);
  });

  it('creates the content, page-builder, history and media tables with RLS', () => {
    for (const table of [
      'cms_documents',
      'cms_document_versions',
      'cms_pages',
      'cms_page_sections',
      'cms_page_versions',
      'cms_media_assets',
    ]) {
      expect(migration).toMatch(new RegExp(`create table if not exists public\\.${table}`));
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('allows browser roles no CMS table writes and no CMS storage writes', () => {
    expect(migration).toMatch(/revoke all on public\.cms_documents[\s\S]*from anon, authenticated/);
    expect(migration).not.toMatch(
      /create policy[^\n]*(insert|update|delete|all)[^\n]*to (anon|authenticated)/i,
    );
    expect(migration).toContain("bucket_id = 'afhomes-cms-media'");
  });

  it('preserves the exact legacy page-builder block vocabulary', () => {
    for (const block of [
      'hero',
      'rich-text',
      'image',
      'gallery',
      'video',
      'two-column',
      'features',
      'services',
      'testimonials',
      'faq',
      'cta',
      'contact',
      'map',
      'divider',
    ]) {
      expect(migration).toContain(`'${block}'`);
    }
  });
});
