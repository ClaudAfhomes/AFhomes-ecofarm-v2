-- Enable Realtime for cms_contents for public CMS live updates (Feature 2)
-- Required for Supabase Realtime postgres_changes on public.cms_contents (INSERT/UPDATE)
-- Smallest safe migration: add table to supabase_realtime publication if not already present
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cms_contents'
  ) then
    alter publication supabase_realtime add table public.cms_contents;
  end if;
end $$;
