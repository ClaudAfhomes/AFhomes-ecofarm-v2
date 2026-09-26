-- Enable Realtime for "Policy" - public policy pages refetch when admin
-- creates/edits/deletes a policy (mirrors the cms_contents realtime pattern).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'Policy'
     ) then
    alter publication supabase_realtime add table public."Policy";
  end if;
end $$;
