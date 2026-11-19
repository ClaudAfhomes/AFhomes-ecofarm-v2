-- AF Homes Phase 6: CMS foundation
-- Forward-only. Does not alter Phase 4 or Phase 5 objects.
-- Public content is delivered by the server API; browser roles receive no table writes.
-- Down: remove the five cms_* tables, afhomes-cms-media bucket, and four cms.* modules
-- only after proving no published content or media is still referenced.

insert into public.modules (key, name, group_name, sort_order)
values
  ('cms.pages', 'CMS Pages and Content', 'Content', 100),
  ('cms.media', 'CMS Media', 'Content', 101),
  ('cms.settings', 'CMS Settings and SEO', 'Content', 102),
  ('cms.history', 'CMS History', 'Content', 103)
on conflict (key) do update set
  name = excluded.name,
  group_name = excluded.group_name,
  sort_order = excluded.sort_order;

create table if not exists public.cms_documents (
  key text primary key check (key in ('site','pageContent','experiences','vip','faq','stories','mediaBlocks')),
  draft_value jsonb not null,
  published_value jsonb,
  status text not null default 'draft' check (status in ('draft','published')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.staff_users(id),
  updated_by uuid not null references public.staff_users(id),
  published_by uuid references public.staff_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (pg_column_size(draft_value) <= 1048576),
  check (published_value is null or pg_column_size(published_value) <= 1048576),
  check ((status = 'draft') or (published_value is not null and published_at is not null and published_by is not null))
);

create table if not exists public.cms_document_versions (
  id bigint generated always as identity primary key,
  document_key text not null references public.cms_documents(key) on delete cascade,
  value jsonb not null check (pg_column_size(value) <= 1048576),
  version integer not null check (version > 0),
  action text not null check (action in ('created','updated','published','unpublished')),
  change_summary text not null check (length(btrim(change_summary)) between 3 and 500),
  created_by uuid not null references public.staff_users(id),
  created_at timestamptz not null default now(),
  unique (document_key, version)
);
create index if not exists cms_document_versions_history
  on public.cms_document_versions(document_key, created_at desc);

create table if not exists public.cms_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (length(btrim(title)) between 1 and 200),
  status text not null default 'draft' check (status in ('draft','published')),
  seo jsonb not null default '{}'::jsonb check (jsonb_typeof(seo) = 'object' and pg_column_size(seo) <= 65536),
  published_snapshot jsonb check (published_snapshot is null or (jsonb_typeof(published_snapshot) = 'object' and pg_column_size(published_snapshot) <= 4194304)),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.staff_users(id),
  updated_by uuid not null references public.staff_users(id),
  published_by uuid references public.staff_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check ((status = 'draft') or (published_snapshot is not null and published_at is not null and published_by is not null))
);

create table if not exists public.cms_page_sections (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.cms_pages(id) on delete cascade,
  block_type text not null check (block_type in ('hero','rich-text','image','gallery','video','two-column','features','services','testimonials','faq','cta','contact','map','divider')),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 1048576),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, sort_order)
);
create index if not exists cms_page_sections_page_order on public.cms_page_sections(page_id, sort_order);

create table if not exists public.cms_page_versions (
  id bigint generated always as identity primary key,
  page_id uuid not null references public.cms_pages(id) on delete cascade,
  slug text not null,
  title text not null,
  status text not null check (status in ('draft','published')),
  seo jsonb not null,
  sections jsonb not null check (jsonb_typeof(sections) = 'array' and pg_column_size(sections) <= 4194304),
  version integer not null check (version > 0),
  action text not null check (action in ('created','updated','published','unpublished')),
  change_summary text not null check (length(btrim(change_summary)) between 3 and 500),
  created_by uuid not null references public.staff_users(id),
  created_at timestamptz not null default now(),
  unique (page_id, version)
);
create index if not exists cms_page_versions_history on public.cms_page_versions(page_id, created_at desc);

create table if not exists public.cms_media_assets (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]+$'),
  public_url text not null check (length(public_url) between 1 and 2000),
  name text not null check (length(btrim(name)) between 1 and 180),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/gif','video/mp4')),
  media_type text not null check (media_type in ('image','video')),
  alt_text text not null default '' check (length(alt_text) <= 500),
  category text not null default 'general' check (length(category) between 1 and 60),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_by uuid not null references public.staff_users(id),
  created_at timestamptz not null default now()
);

alter table public.cms_documents enable row level security;
alter table public.cms_document_versions enable row level security;
alter table public.cms_pages enable row level security;
alter table public.cms_page_sections enable row level security;
alter table public.cms_page_versions enable row level security;
alter table public.cms_media_assets enable row level security;

revoke all on public.cms_documents, public.cms_document_versions, public.cms_pages,
  public.cms_page_sections, public.cms_page_versions, public.cms_media_assets from anon, authenticated;

grant select on public.cms_documents, public.cms_pages, public.cms_page_sections, public.cms_media_assets to authenticated;
grant select on public.cms_document_versions, public.cms_page_versions to authenticated;

create policy cms_documents_staff_read on public.cms_documents for select to authenticated
  using (private.has_permission('cms.pages') or private.has_permission('cms.settings'));
create policy cms_document_versions_staff_read on public.cms_document_versions for select to authenticated
  using (private.has_permission('cms.history'));
create policy cms_pages_staff_read on public.cms_pages for select to authenticated
  using (private.has_permission('cms.pages'));
create policy cms_page_sections_staff_read on public.cms_page_sections for select to authenticated
  using (private.has_permission('cms.pages'));
create policy cms_page_versions_staff_read on public.cms_page_versions for select to authenticated
  using (private.has_permission('cms.history'));
create policy cms_media_assets_staff_read on public.cms_media_assets for select to authenticated
  using (private.has_permission('cms.media'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'afhomes-cms-media', 'afhomes-cms-media', true, 10485760,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public delivery is read-only. Upload and deletion use the server service role.
drop policy if exists afhomes_cms_media_public_read on storage.objects;
create policy afhomes_cms_media_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'afhomes-cms-media');
