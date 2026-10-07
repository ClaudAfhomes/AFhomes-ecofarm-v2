-- AF Homes communications foundation: conversations, messages, announcements,
-- notifications, and the fifteen SECURITY DEFINER entry points that own them.
-- Forward-only. Every statement is idempotent, so this file is safe to apply to
-- a database of unknown provenance: applying it to an already-correct database
-- reconciles and changes nothing.
--
-- Validation before apply (every query must return zero rows):
--   -- no communications privilege reaches a browser role:
--   select grantee, table_name, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name like 'communication%' or table_name = 'notifications'
--      and grantee in ('PUBLIC','anon','authenticated');
--   -- no communications routine reaches a browser role:
--   select grantee, routine_name from information_schema.role_routine_grants
--    where routine_schema = 'public' and routine_name like 'communication%'
--      and grantee in ('PUBLIC','anon','authenticated');
--   -- the widened idempotency registry still admits the original three:
--   select count(*) from private.mutation_requests
--    where operation in ('payment.create','application.create','reservation.create');
--
-- Validation after apply (expected):
--   select count(*) from information_schema.tables
--    where table_schema='public' and (table_name like 'communication%' or table_name='notifications'); -- 7
--   select key from public.modules where key like 'communications.%' order by key; -- 3 rows
--   select r.slug, count(*) from public.role_permissions rp
--     join public.roles r on r.id=rp.role_id
--     join public.modules m on m.id=rp.module_id
--    where m.key like 'communications.%' group by 1; -- 24 rows over 8 roles
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='private.mutation_requests'::regclass and contype='c'; -- operation_check, six values
--
-- Down (forward-only; this note is documentation, not a script): retire the
-- communications API callers first, then a later migration drops the fifteen
-- functions, the seven tables and the twenty-four role_permissions rows whose
-- module key begins 'communications.'. Never delete message rows, announcement
-- bodies or audit history, and never rewrite the modules the baseline already
-- seeded. Removing this file's own rows is a separate, reviewed migration.

-- ---------------------------------------------------------------------------
-- 1. Module vocabulary. No new authorization model: 'super_admin' keeps its
--    implicit full access by slug, and customer access stays ownership-only.
-- ---------------------------------------------------------------------------

insert into public.modules (key, name, group_name, sort_order)
values
  ('communications.messages', 'Communications Messages', 'Communications', 110),
  ('communications.announcements', 'Communications Announcements', 'Communications', 111),
  ('communications.notifications', 'Communications Notifications', 'Communications', 112)
on conflict (key) do update set
  name = excluded.name,
  group_name = excluded.group_name,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 2. Tables.
--    Browser roles receive NOTHING (section 5): this feature is service-role
--    and RPC only, so RLS is enabled as a belt-and-braces invariant and every
--    table privilege is revoked from public, anon and authenticated.
-- ---------------------------------------------------------------------------

create table if not exists public.communication_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct','group')),
  title text null check (title is null or char_length(btrim(title)) between 1 and 200),
  created_by uuid not null references public.staff_users(id) on delete restrict,
  status text not null default 'active' check (status in ('active','archived')),
  direct_lowest uuid null references public.staff_users(id) on delete restrict,
  direct_highest uuid null references public.staff_users(id) on delete restrict,
  current_sequence bigint not null default 0 check (current_sequence >= 0),
  created_at timestamptz not null default now(),
  archived_at timestamptz null,
  check ((kind='direct' and direct_lowest is not null and direct_highest is not null and direct_lowest < direct_highest and title is null)
      or (kind='group' and direct_lowest is null and direct_highest is null and title is not null))
);

-- One row per (conversation, staff, visit). Leaving is never a row deletion:
-- the interval is closed, so the message history a member could once read
-- stays readable and the audit trail keeps its shape.
create table if not exists public.communication_conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.communication_conversations(id) on delete restrict,
  staff_id uuid not null references public.staff_users(id) on delete restrict,
  is_manager boolean not null default false,
  joined_sequence bigint not null check (joined_sequence >= 0),
  left_sequence bigint null check (left_sequence is null or left_sequence > joined_sequence),
  last_read_sequence bigint not null default -1,
  last_read_at timestamptz null,
  joined_at timestamptz not null default now(),
  left_at timestamptz null
);

-- Reconcile a database that already received the earlier table-level UNIQUE.
-- `create or replace function` never touches a table constraint, and this file
-- is declared safe to apply to a database of unknown provenance, so the
-- superseded constraint is dropped by name RESOLVED FROM THE CATALOG (never
-- assumed) - the same idiom section 4 uses for the idempotency CHECK. Without
-- it, re-applying the file would stack the replacement index on top of a
-- constraint that still forbids two founding members. This runs BEFORE the
-- index drop below, because a constraint-backed index cannot be dropped while
-- its constraint still exists.
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public' and rel.relname = 'communication_conversation_members'
       and con.contype = 'u'
       and array_length(con.conkey, 1) = 2
       and con.conkey @> array[
         (select attnum from pg_attribute
           where attrelid = rel.oid and attname = 'conversation_id'),
         (select attnum from pg_attribute
           where attrelid = rel.oid and attname = 'joined_sequence')]
  loop
    execute format('alter table public.communication_conversation_members drop constraint %I', c.conname);
  end loop;
end $$;

-- The conversation-scoped unique index this file used to declare (partial on
-- `joined_sequence > 0`) is dropped by name RESOLVED FROM THE CATALOG, never
-- assumed: it is identified by the exact column list it indexes, so the name is
-- never written here. Leaving it would keep the defect it introduced - two
-- members added back to back with no message in between both take
-- `current_sequence + 1` and would collide.
do $$
declare
  i record;
begin
  for i in
    select idx.relname
      from pg_index ix
      join pg_class idx on idx.oid = ix.indexrelid
      join pg_class rel on rel.oid = ix.indrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public' and rel.relname = 'communication_conversation_members'
       and ix.indisunique
       and ix.indkey::smallint[] = array[
         (select attnum from pg_attribute
           where attrelid = rel.oid and attname = 'conversation_id'),
         (select attnum from pg_attribute
           where attrelid = rel.oid and attname = 'joined_sequence')]::smallint[]
  loop
    execute format('drop index if exists public.%I', i.relname);
  end loop;
end $$;

-- One interval per STAFF per starting point in time. Uniqueness is per staff,
-- never per conversation: several members legitimately share a
-- `joined_sequence` - that is exactly what a founding cohort is (every founder
-- joins at sequence 0, so they all see the conversation from its first
-- message), and what two members added with no message sent between them are
-- (both take `current_sequence + 1`). Keying on the conversation alone made
-- every group with more than two participants impossible to create, and then,
-- once excluded, made adding two members back to back impossible. What must
-- never happen is ONE staff member holding two intervals that start at the same
-- sequence, which a re-add would otherwise be free to create.
create unique index if not exists communication_conversation_members_interval_idx on public.communication_conversation_members (conversation_id, staff_id, joined_sequence);

-- The direct pair is identified by the two staff ids in a fixed order, so the
-- same two people can never open two direct conversations.
create unique index if not exists communication_conversations_direct_pair_idx on public.communication_conversations (direct_lowest, direct_highest) where kind='direct';

-- At most one OPEN interval per staff per conversation. Rejoining after a
-- removal creates a second interval, which the partial index permits while the
-- closed one stays on the record.
create unique index if not exists communication_conversation_members_one_open_idx on public.communication_conversation_members (conversation_id, staff_id) where left_sequence is null;

-- sequence is the conversation-local ordering assigned under the row lock;
-- (created_at, id) is the stable keyset the read path pages on.
create table if not exists public.communication_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.communication_conversations(id) on delete restrict,
  sender_staff_id uuid not null references public.staff_users(id) on delete restrict,
  sender_full_name text not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  sequence bigint not null check (sequence > 0),
  created_at timestamptz not null default now(),
  unique (conversation_id, sequence)
);

create index if not exists communication_messages_keyset_idx on public.communication_messages (conversation_id, created_at desc, id desc);

-- Only a draft is editable. published_at is stamped once and never cleared,
-- which is what makes the recipient set below a frozen record.
create table if not exists public.communication_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by uuid not null references public.staff_users(id) on delete restrict,
  updated_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz null,
  archived_at timestamptz null,
  check ((status='draft' and published_at is null)
      or (status in ('published','archived') and published_at is not null)),
  check (status <> 'archived' or archived_at is not null)
);

-- Audiences are normalized rows, never a delimited string: exactly one
-- discriminator is set per row, so the union at publish time is a plain OR.
create table if not exists public.communication_announcement_audiences (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.communication_announcements(id) on delete restrict,
  audience_kind text not null check (audience_kind in ('all_staff','role','department','staff')),
  role_slug text null,
  department_id uuid null references public.departments(id) on delete restrict,
  staff_id uuid null references public.staff_users(id) on delete restrict,
  check ((audience_kind='all_staff' and role_slug is null and department_id is null and staff_id is null)
      or (audience_kind='role' and role_slug is not null and department_id is null and staff_id is null)
      or (audience_kind='department' and role_slug is null and department_id is not null and staff_id is null)
      or (audience_kind='staff' and role_slug is null and department_id is null and staff_id is not null)),
  unique (announcement_id, audience_kind, role_slug, department_id, staff_id)
);

-- Frozen at publish time: a later joiner, a role change or a staff deletion
-- cannot rewrite who was told what.
create table if not exists public.communication_announcement_recipients (
  announcement_id uuid not null references public.communication_announcements(id) on delete restrict,
  staff_id uuid not null references public.staff_users(id) on delete restrict,
  published_at timestamptz not null,
  read_at timestamptz null,
  primary key (announcement_id, staff_id)
);

-- recipient_staff_id is NEVER nullable: a notification with no owner is
-- unreadable and undeletable, so the column refuses it outright.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_staff_id uuid not null references public.staff_users(id) on delete restrict,
  notification_type text not null check (notification_type in ('message','announcement','group_removal')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text not null check (char_length(btrim(summary)) between 1 and 500),
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  unique (recipient_staff_id, notification_type, entity_id)
);

create index if not exists notifications_recipient_idx on public.notifications (recipient_staff_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (recipient_staff_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- 3. Role permissions. The database copy of the approved communications
--    matrix in packages/contracts role-baseline.ts; the historical baseline
--    file is immutable, so these rows are additive here. super_admin and
--    customer hold NO row: super_admin stays implicit, and customer access is
--    ownership, never permission.
-- ---------------------------------------------------------------------------

insert into public.role_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, v.can_view, v.can_create, v.can_update, v.can_delete
from (values
  -- admin: full message management and the only announcement writer. Its own
  -- notifications are read/write (mark read), not create - the row already
  -- exists, so a create grant would authorize nothing.
  ('admin', 'communications.messages', true, true, true, false),
  ('admin', 'communications.announcements', true, true, true, false),
  ('admin', 'communications.notifications', true, false, true, false),
  -- finance, hr, ost, employee: send and read, read/write their notifications.
  ('finance', 'communications.messages', true, true, false, false),
  ('finance', 'communications.announcements', true, false, false, false),
  ('finance', 'communications.notifications', true, false, true, false),
  ('hr', 'communications.messages', true, true, false, false),
  ('hr', 'communications.announcements', true, false, false, false),
  ('hr', 'communications.notifications', true, false, true, false),
  ('ost', 'communications.messages', true, true, false, false),
  ('ost', 'communications.announcements', true, false, false, false),
  ('ost', 'communications.notifications', true, false, true, false),
  ('employee', 'communications.messages', true, true, false, false),
  ('employee', 'communications.announcements', true, false, false, false),
  ('employee', 'communications.notifications', true, false, true, false),
  -- the three management tiers also manage group membership.
  ('vice_director', 'communications.messages', true, true, true, false),
  ('vice_director', 'communications.announcements', true, false, false, false),
  ('vice_director', 'communications.notifications', true, false, true, false),
  ('senior_sales_manager', 'communications.messages', true, true, true, false),
  ('senior_sales_manager', 'communications.announcements', true, false, false, false),
  ('senior_sales_manager', 'communications.notifications', true, false, true, false),
  ('sales_manager', 'communications.messages', true, true, true, false),
  ('sales_manager', 'communications.announcements', true, false, false, false),
  ('sales_manager', 'communications.notifications', true, false, true, false)
) as v(role_slug, module_key, can_view, can_create, can_update, can_delete)
join public.roles r on r.slug = v.role_slug
join public.modules m on m.key = v.module_key
on conflict (role_id, module_id) do update set
  can_view = excluded.can_view,
  can_create = excluded.can_create,
  can_update = excluded.can_update,
  can_delete = excluded.can_delete;

-- ---------------------------------------------------------------------------
-- 4. Widen the durable-mutation registry. The CHECK is replaced by a strict
--    SUPERSET: the three historical operations stay admitted, so an already
--    populated registry keeps validating, and no second registry is created.
--    The drop is by the generated constraint name, resolved from the catalog
--    rather than assumed, and the re-add re-validates every existing row.
-- ---------------------------------------------------------------------------

do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'private' and rel.relname = 'mutation_requests'
       and con.contype = 'c'
       and con.conkey = array[(select attnum from pg_attribute
                               where attrelid = rel.oid and attname = 'operation')]
  loop
    execute format('alter table private.mutation_requests drop constraint %I', c.conname);
  end loop;
end $$;

alter table private.mutation_requests
  add constraint mutation_requests_operation_check
  check (operation in ('payment.create','application.create','reservation.create','conversation.create','message.send','announcement.publish'));

-- ---------------------------------------------------------------------------
-- 5. RLS and privileges. Enabled and fully revoked for all seven tables: no
--    browser policy, no browser grant, no sequence.
-- ---------------------------------------------------------------------------

alter table public.communication_conversations enable row level security; revoke all on public.communication_conversations from public, anon, authenticated;
alter table public.communication_conversation_members enable row level security; revoke all on public.communication_conversation_members from public, anon, authenticated;
alter table public.communication_messages enable row level security; revoke all on public.communication_messages from public, anon, authenticated;
alter table public.communication_announcements enable row level security; revoke all on public.communication_announcements from public, anon, authenticated;
alter table public.communication_announcement_audiences enable row level security; revoke all on public.communication_announcement_audiences from public, anon, authenticated;
alter table public.communication_announcement_recipients enable row level security; revoke all on public.communication_announcement_recipients from public, anon, authenticated;
alter table public.notifications enable row level security; revoke all on public.notifications from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Read entry points.
--
--    Actor resolution note: the real private.has_permission(permission_key,
--    action_name) resolves the CALLER from auth.uid(). These functions are
--    SECURITY DEFINER and carry an explicit server-derived actor, so actor
--    authorization uses private.mutation_actor_role(p_actor, module, action),
--    which applies the identical active-staff / active-role / active-module /
--    deny-only model and raises MUTATION_FORBIDDEN instead of returning false.
--
--    Every relation below is schema-qualified and aliased: an unqualified name
--    inside a `returns table` function collides with an OUT parameter, which is
--    exactly how verify_card_payment failed on every call in Phase 5.
-- ---------------------------------------------------------------------------

create or replace function public.communication_visible_messages(p_actor uuid, p_conversation uuid, p_before_created_at timestamptz default null, p_before_id uuid default null, p_limit int default 50)
returns table(id uuid, conversation_id uuid, sequence bigint, sender_staff_id uuid, sender_full_name text, body text, created_at timestamptz, has_more boolean)
language sql stable security definer set search_path = public, private as $$
  with lim as (select greatest(1, least(100, coalesce(p_limit, 50))) as n),
  page as (
    select m.id as id, m.conversation_id as conversation_id, m.sequence as sequence,
           m.sender_staff_id as sender_staff_id, m.sender_full_name as sender_full_name,
           m.body as body, m.created_at as created_at,
           row_number() over (order by m.created_at desc, m.id desc) as rn
      from public.communication_messages m
     where m.conversation_id = p_conversation
       and exists (select 1 from public.communication_conversation_members mem
                    where mem.conversation_id = m.conversation_id
                      and mem.staff_id = p_actor
                      and mem.joined_sequence <= m.sequence
                      and (mem.left_sequence is null or m.sequence < mem.left_sequence))
       and (p_before_created_at is null
            or (m.created_at, m.id) < (p_before_created_at, p_before_id))
  )
  select page.id, page.conversation_id, page.sequence, page.sender_staff_id,
         page.sender_full_name, page.body, page.created_at,
         page.rn <= (select n from lim) as has_more
    from page cross join lim
   where page.rn <= (select n from lim) + 1
   order by page.rn;
$$;

create or replace function public.communication_unread_counts(p_actor uuid)
returns table(conversation_id uuid, unread bigint, total_unread bigint)
language sql stable security definer set search_path = public, private as $$
  with per_conversation as (
    select cmem.conversation_id as conversation_id,
           (select count(*)::bigint from public.communication_messages m
             where m.conversation_id = cmem.conversation_id
               and m.sequence > cmem.last_read_sequence
               and m.sender_staff_id is distinct from p_actor
               and exists (select 1 from public.communication_conversation_members mem
                            where mem.conversation_id = m.conversation_id
                              and mem.staff_id = p_actor
                              and mem.joined_sequence <= m.sequence
                              and (mem.left_sequence is null or m.sequence < mem.left_sequence))
           ) as unread
      from public.communication_conversation_members cmem
     where cmem.staff_id = p_actor and cmem.left_sequence is null
  )
  select per_conversation.conversation_id, per_conversation.unread,
         coalesce(sum(per_conversation.unread) over (), 0::bigint) as total_unread
    from per_conversation
   order by per_conversation.conversation_id;
$$;

create or replace function public.communication_announcement_feed(p_actor uuid, p_limit int default 50, p_before uuid default null)
returns table(id uuid, title text, body text, published_at timestamptz, read_at timestamptz, has_more boolean)
language sql stable security definer set search_path = public, private as $$
  with lim as (select greatest(1, least(100, coalesce(p_limit, 50))) as n),
  page as (
    select a.id as id, a.title as title, a.body as body, a.published_at as published_at,
           rec.read_at as read_at,
           row_number() over (order by a.published_at desc, a.id desc) as rn
      from public.communication_announcement_recipients rec
      join public.communication_announcements a on a.id = rec.announcement_id and a.status = 'published'
     where rec.staff_id = p_actor
       and (p_before is null
            or (a.published_at, a.id) < (select b.published_at, b.id
                                           from public.communication_announcements b where b.id = p_before))
  )
  select page.id, page.title, page.body, page.published_at, page.read_at,
         page.rn <= (select n from lim) as has_more
    from page cross join lim
   where page.rn <= (select n from lim) + 1
   order by page.rn;
$$;

-- ---------------------------------------------------------------------------
-- 7. Conversation writes.
--    Lock order is fixed and TOTAL: conversation -> membership -> notification.
--    The conversation row is always locked FIRST, and every mutating function
--    re-resolves the actor in SQL before touching a row.
-- ---------------------------------------------------------------------------

create or replace function public.communication_create_conversation(p_actor uuid, p_kind text, p_title text, p_participant_ids uuid[], p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare
  v_kind text := btrim(coalesce(p_kind, ''));
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_members uuid[];
  v_conversation uuid;
  v_result uuid;
  v_payload jsonb;
  v_low uuid;
  v_high uuid;
begin
  perform private.mutation_actor_role(p_actor, 'communications.messages', 'create');
  v_members := array(select distinct x from unnest(coalesce(p_participant_ids, '{}'::uuid[]) || p_actor) as x);
  -- Only the length and the digest of the request are retained, never a body.
  v_payload := jsonb_build_object('kind', v_kind, 'title', v_title,
    'participants', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from unnest(v_members) as x));
  v_result := private.mutation_result(p_actor, 'conversation.create', p_request_id, v_payload);
  if v_result is not null then return v_result; end if;
  if v_kind not in ('direct','group') then raise exception 'INVALID_CONVERSATION_KIND' using errcode = '22023'; end if;
  if v_members is null or cardinality(v_members) < 1 then raise exception 'INVALID_PARTICIPANT' using errcode = '22023'; end if;
  -- Every participant must be an ACTIVE staff member holding the view action:
  -- the same predicate private.mutation_actor_role applies, as a set filter.
  -- (private.has_permission resolves auth.uid(), so it cannot ask about
  -- another staff member; this is that predicate written out.)
  if exists (
    select 1 from unnest(v_members) as x
     where not exists (
       select 1
         from public.staff_users s
         join public.staff_role_assignments ra on ra.staff_id = s.id
         join public.roles r on r.id = ra.role_id and r.is_active
         join public.modules mo on mo.key = 'communications.messages' and mo.is_active
         left join public.role_permissions rp on rp.role_id = r.id and rp.module_id = mo.id
         left join public.staff_permission_restrictions deny on deny.staff_id = s.id and deny.module_id = mo.id
        where s.id = x and s.status = 'active'
          and (r.slug = 'super_admin' or coalesce(rp.can_view, false))
          and not coalesce(deny.deny_view, false))
  ) then raise exception 'INVALID_PARTICIPANT' using errcode = '22023'; end if;
  if v_kind = 'direct' then
    if cardinality(v_members) <> 2 or v_title is not null then
      raise exception 'INVALID_DIRECT_CONVERSATION' using errcode = '22023';
    end if;
    select x into v_low from unnest(v_members) as t(x) order by x asc limit 1;
    select x into v_high from unnest(v_members) as t(x) order by x desc limit 1;
    -- Canonical ordering alone is NOT enough. Two concurrent creates for the
    -- same pair with different request ids both pass the existence check and one
    -- dies on the direct-pair unique index, while the approved spec says the
    -- same pair returns that conversation. The lock is taken on the SORTED pair
    -- so it is the pair that serializes - a lock on one participant would
    -- serialize two unrelated conversations instead.
    perform pg_advisory_xact_lock(hashtextextended(
      'communication.direct:' || v_low::text || ':' || v_high::text, 0));
    -- Re-checked UNDER the lock: check-then-insert without one is the race.
    select c.id into v_conversation from public.communication_conversations c
     where c.kind = 'direct' and c.direct_lowest = v_low and c.direct_highest = v_high;
    if v_conversation is not null then
      -- Recorded like any other successful outcome, so a client retry with the
      -- same request id returns the same conversation through the registry.
      perform private.complete_mutation(p_actor, 'conversation.create', p_request_id, v_payload, v_conversation);
      return v_conversation;
    end if;
    insert into public.communication_conversations (kind, created_by, direct_lowest, direct_highest)
    values ('direct', p_actor, v_low, v_high)
    returning id into v_conversation;
  else
    if v_title is null then raise exception 'CONVERSATION_TITLE_REQUIRED' using errcode = '22023'; end if;
    if cardinality(v_members) < 2 then raise exception 'INVALID_PARTICIPANT' using errcode = '22023'; end if;
    insert into public.communication_conversations (kind, title, created_by)
    values ('group', v_title, p_actor)
    returning id into v_conversation;
  end if;
  insert into public.communication_conversation_members (conversation_id, staff_id, joined_sequence)
  select v_conversation, x, 0 from unnest(v_members) as x
  on conflict (conversation_id, staff_id) where left_sequence is null do nothing;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (p_actor, 'CONVERSATION_CREATED', 'communication_conversation', v_conversation::text,
          jsonb_build_object('kind', v_kind, 'memberCount', cardinality(v_members)));
  perform private.complete_mutation(p_actor, 'conversation.create', p_request_id, v_payload, v_conversation);
  return v_conversation;
end $$;

create or replace function public.communication_add_member(p_actor uuid, p_conversation uuid, p_staff uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_conversation public.communication_conversations%rowtype;
begin
  perform private.mutation_actor_role(p_actor, 'communications.messages', 'update');
  select c.* into v_conversation from public.communication_conversations c
   where c.id = p_conversation for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_conversation.status <> 'active' then raise exception 'CONVERSATION_ARCHIVED' using errcode = '22023'; end if;
  if v_conversation.kind <> 'group' then raise exception 'NOT_A_GROUP_CONVERSATION' using errcode = '22023'; end if;
  if not exists (select 1 from public.communication_conversation_members mem
                   where mem.conversation_id = p_conversation and mem.staff_id = p_actor and mem.left_sequence is null) then
    raise exception 'NOT_A_CONVERSATION_MEMBER' using errcode = '42501';
  end if;
  if p_staff = p_actor then raise exception 'INVALID_MEMBER' using errcode = '22023'; end if;
  -- Same view-action predicate as create_conversation: membership itself is a
  -- read grant, so an ineligible staff member must never receive it.
  if not exists (
    select 1
      from public.staff_users s
      join public.staff_role_assignments ra on ra.staff_id = s.id
      join public.roles r on r.id = ra.role_id and r.is_active
      join public.modules mo on mo.key = 'communications.messages' and mo.is_active
      left join public.role_permissions rp on rp.role_id = r.id and rp.module_id = mo.id
      left join public.staff_permission_restrictions deny on deny.staff_id = s.id and deny.module_id = mo.id
     where s.id = p_staff and s.status = 'active'
       and (r.slug = 'super_admin' or coalesce(rp.can_view, false))
       and not coalesce(deny.deny_view, false)
  ) then raise exception 'MEMBER_FORBIDDEN' using errcode = '42501'; end if;
  if exists (select 1 from public.communication_conversation_members mem
              where mem.conversation_id = p_conversation and mem.staff_id = p_staff and mem.left_sequence is null) then
    return;
  end if;
  insert into public.communication_conversation_members (conversation_id, staff_id, joined_sequence)
  values (p_conversation, p_staff, v_conversation.current_sequence + 1)
  on conflict (conversation_id, staff_id) where left_sequence is null do nothing;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (p_actor, 'CONVERSATION_MEMBER_ADDED', 'communication_conversation', p_conversation::text,
          jsonb_build_object('staffId', p_staff));
end $$;

create or replace function public.communication_remove_member(p_actor uuid, p_conversation uuid, p_staff uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_conversation public.communication_conversations%rowtype;
begin
  perform private.mutation_actor_role(p_actor, 'communications.messages', 'update');
  select c.* into v_conversation from public.communication_conversations c
   where c.id = p_conversation for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.communication_conversation_members mem
                   where mem.conversation_id = p_conversation and mem.staff_id = p_actor and mem.left_sequence is null) then
    raise exception 'NOT_A_CONVERSATION_MEMBER' using errcode = '42501';
  end if;
  -- Close the interval instead of deleting the row: the member keeps reading
  -- everything from sequence 1 up to, but not including, the closing point.
  update public.communication_conversation_members mem
     set left_sequence = v_conversation.current_sequence + 1, left_at = now()
   where mem.conversation_id = p_conversation
     and mem.staff_id = p_staff
     and mem.left_sequence is null;
  if not found then raise exception 'MEMBER_NOT_PRESENT' using errcode = 'P0002'; end if;
  -- Exactly one generic notification per (recipient, conversation): the unique
  -- key makes a retry or a second removal produce no duplicate row.
  insert into public.notifications (recipient_staff_id, notification_type, title, summary, entity_type, entity_id)
  values (p_staff, 'group_removal', 'Removed from a conversation',
          'You were removed from a group conversation. Earlier messages remain visible to you.',
          'communication_conversation', p_conversation)
  on conflict (recipient_staff_id, notification_type, entity_id) do nothing;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (p_actor, 'CONVERSATION_MEMBER_REMOVED', 'communication_conversation', p_conversation::text,
          jsonb_build_object('staffId', p_staff));
end $$;

create or replace function public.communication_archive_conversation(p_actor uuid, p_conversation uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_conversation public.communication_conversations%rowtype;
begin
  perform private.mutation_actor_role(p_actor, 'communications.messages', 'update');
  select c.* into v_conversation from public.communication_conversations c
   where c.id = p_conversation for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.communication_conversation_members mem
                   where mem.conversation_id = p_conversation and mem.staff_id = p_actor and mem.left_sequence is null) then
    raise exception 'NOT_A_CONVERSATION_MEMBER' using errcode = '42501';
  end if;
  if v_conversation.status = 'archived' then return; end if;
  update public.communication_conversations c
     set status = 'archived', archived_at = now()
   where c.id = p_conversation;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (p_actor, 'CONVERSATION_ARCHIVED', 'communication_conversation', p_conversation::text,
          jsonb_build_object('status', 'archived', 'finalSequence', v_conversation.current_sequence));
end $$;

create or replace function public.communication_send_message(p_actor uuid, p_conversation uuid, p_body text, p_request_id uuid)
returns bigint language plpgsql security definer set search_path = public, private as $$
declare
  v_conversation public.communication_conversations%rowtype;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_sequence bigint;
  v_message uuid;
  v_name text;
  v_result uuid;
  v_payload jsonb;
begin
  perform private.mutation_actor_role(p_actor, 'communications.messages', 'create');
  if v_body is null or char_length(v_body) > 4000 then
    raise exception 'INVALID_MESSAGE_BODY' using errcode = '22023';
  end if;
  -- md5 (built-in, always resolvable) fingerprints the body for the retry
  -- comparison. The body itself is never written to the request registry.
  v_payload := jsonb_build_object('conversationId', p_conversation, 'bodyMd5', md5(v_body));
  v_result := private.mutation_result(p_actor, 'message.send', p_request_id, v_payload);
  if v_result is not null then
    select m.sequence into v_sequence from public.communication_messages m where m.id = v_result;
    return v_sequence;
  end if;
  select c.* into v_conversation from public.communication_conversations c
   where c.id = p_conversation for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_conversation.status <> 'active' then raise exception 'CONVERSATION_ARCHIVED' using errcode = '22023'; end if;
  if not exists (select 1 from public.communication_conversation_members mem
                   where mem.conversation_id = p_conversation and mem.staff_id = p_actor and mem.left_sequence is null) then
    raise exception 'NOT_A_CONVERSATION_MEMBER' using errcode = '42501';
  end if;
  select s.full_name into v_name from public.staff_users s where s.id = p_actor;
  update public.communication_conversations c
     set current_sequence = v_conversation.current_sequence + 1
   where c.id = p_conversation
  returning c.current_sequence into v_sequence;
  -- created_at is strictly monotonic per conversation, so the (created_at, id)
  -- keyset can never reorder or skip a message even inside one millisecond.
  insert into public.communication_messages (conversation_id, sender_staff_id, sender_full_name, body, sequence, created_at)
  values (p_conversation, p_actor, v_name, v_body, v_sequence,
          greatest(now(), (select coalesce(max(m.created_at), now())
                             from public.communication_messages m
                            where m.conversation_id = p_conversation) + interval '1 microsecond'))
  returning id into v_message;
  -- One notification per CURRENTLY-ACTIVE eligible member, sender excluded.
  insert into public.notifications (recipient_staff_id, notification_type, title, summary, entity_type, entity_id)
  select mem.staff_id, 'message', 'New message', 'A new message was posted in a conversation you belong to.',
         'communication_message', v_message
    from public.communication_conversation_members mem
    join public.staff_users s on s.id = mem.staff_id and s.status = 'active'
    join public.staff_role_assignments ra on ra.staff_id = s.id
    join public.roles r on r.id = ra.role_id and r.is_active
    join public.modules mo on mo.key = 'communications.messages' and mo.is_active
    left join public.role_permissions rp on rp.role_id = r.id and rp.module_id = mo.id
    left join public.staff_permission_restrictions deny on deny.staff_id = s.id and deny.module_id = mo.id
   where mem.conversation_id = p_conversation
     and mem.left_sequence is null
     and mem.staff_id <> p_actor
     and (r.slug = 'super_admin' or coalesce(rp.can_view, false))
     and not coalesce(deny.deny_view, false)
  on conflict (recipient_staff_id, notification_type, entity_id) do nothing;
  perform private.complete_mutation(p_actor, 'message.send', p_request_id, v_payload, v_message);
  return v_sequence;
end $$;

create or replace function public.communication_mark_read(p_actor uuid, p_conversation uuid, p_message_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_message public.communication_messages%rowtype;
begin
  -- Actor standing is re-validated FIRST, exactly like every other mutating
  -- entry point. Membership alone was the gap: a member whose
  -- communications.messages view is denied could still advance their own read
  -- marker, which is a state change nobody should be able to make. Membership
  -- then decides WHICH messages this actor may mark.
  perform private.mutation_actor_role(p_actor, 'communications.messages', 'view');
  select m.* into v_message from public.communication_messages m
   where m.id = p_message_id and m.conversation_id = p_conversation;
  if not found then raise exception 'MESSAGE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.communication_conversation_members mem
                   where mem.conversation_id = p_conversation and mem.staff_id = p_actor and mem.left_sequence is null
                     and mem.joined_sequence <= v_message.sequence
                     and (mem.left_sequence is null or v_message.sequence < mem.left_sequence)) then
    raise exception 'MESSAGE_NOT_VISIBLE' using errcode = '42501';
  end if;
  update public.communication_conversation_members mem
     set last_read_sequence = greatest(mem.last_read_sequence, v_message.sequence),
         last_read_at = now()
   where mem.conversation_id = p_conversation and mem.staff_id = p_actor and mem.left_sequence is null;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Announcements. A draft is the only editable state; publishing freezes the
--    recipient set and the audience rows stop meaning anything afterwards.
-- ---------------------------------------------------------------------------

create or replace function public.communication_save_announcement(p_actor uuid, p_announcement uuid, p_title text, p_body text, p_audiences jsonb)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare
  v_row public.communication_announcements%rowtype;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_entry jsonb;
  v_kind text;
  v_count int := 0;
begin
  perform private.mutation_actor_role(p_actor, 'communications.announcements', 'update');
  if p_announcement is null then raise exception 'ANNOUNCEMENT_ID_REQUIRED' using errcode = '22023'; end if;
  if v_title is null or char_length(v_title) > 200 then raise exception 'INVALID_ANNOUNCEMENT_TITLE' using errcode = '22023'; end if;
  if v_body is null or char_length(v_body) > 10000 then raise exception 'INVALID_ANNOUNCEMENT_BODY' using errcode = '22023'; end if;
  if p_audiences is not null and jsonb_typeof(p_audiences) <> 'array' then
    raise exception 'INVALID_AUDIENCE' using errcode = '22023';
  end if;
  select a.* into v_row from public.communication_announcements a
   where a.id = p_announcement for update;
  if found then
    if v_row.status <> 'draft' then raise exception 'ANNOUNCEMENT_IMMUTABLE' using errcode = '22023'; end if;
    update public.communication_announcements a
       set title = v_title, body = v_body, updated_by = p_actor, updated_at = now()
     where a.id = p_announcement;
    insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
    values (p_actor, 'ANNOUNCEMENT_UPDATED', 'communication_announcement', p_announcement::text,
            jsonb_build_object('status', 'draft', 'titleLength', char_length(v_title)));
  else
    insert into public.communication_announcements (id, title, body, created_by, updated_by)
    values (p_announcement, v_title, v_body, p_actor, p_actor);
    insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
    values (p_actor, 'ANNOUNCEMENT_CREATED', 'communication_announcement', p_announcement::text,
            jsonb_build_object('status', 'draft', 'titleLength', char_length(v_title)));
  end if;
  delete from public.communication_announcement_audiences where announcement_id = p_announcement;
  for v_entry in select value from jsonb_array_elements(coalesce(p_audiences, '[]'::jsonb)) as t(value)
  loop
    v_kind := btrim(coalesce(v_entry->>'kind', v_entry->>'audienceKind', ''));
    if v_kind not in ('all_staff','role','department','staff') then
      raise exception 'INVALID_AUDIENCE' using errcode = '22023';
    end if;
    insert into public.communication_announcement_audiences (announcement_id, audience_kind, role_slug, department_id, staff_id)
    values (p_announcement, v_kind,
            nullif(btrim(coalesce(v_entry->>'roleSlug', '')), ''),
            nullif(btrim(coalesce(v_entry->>'departmentId', '')), '')::uuid,
            nullif(btrim(coalesce(v_entry->>'staffId', '')), '')::uuid)
    on conflict (announcement_id, audience_kind, role_slug, department_id, staff_id) do nothing;
    v_count := v_count + 1;
  end loop;
  return p_announcement;
end $$;

create or replace function public.communication_publish_announcement(p_actor uuid, p_announcement uuid, p_request_id uuid)
returns int language plpgsql security definer set search_path = public, private as $$
declare
  v_row public.communication_announcements%rowtype;
  v_payload jsonb;
  v_result uuid;
  v_count int;
begin
  perform private.mutation_actor_role(p_actor, 'communications.announcements', 'update');
  v_payload := jsonb_build_object('announcementId', p_announcement);
  v_result := private.mutation_result(p_actor, 'announcement.publish', p_request_id, v_payload);
  if v_result is not null then
    select count(*)::int into v_count from public.communication_announcement_recipients rec
     where rec.announcement_id = p_announcement;
    return v_count;
  end if;
  select a.* into v_row from public.communication_announcements a
   where a.id = p_announcement for update;
  if not found then raise exception 'ANNOUNCEMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status <> 'draft' then raise exception 'ANNOUNCEMENT_NOT_DRAFT' using errcode = '22023'; end if;
  -- The audience is resolved as a UNION over currently-active staff, so a
  -- role, a department and an individual overlap without double delivery.
  --
  -- The recipient set is FROZEN, so this filter is permanent: a staff member who
  -- is denied communications.announcements here is denied for good. It therefore
  -- carries the IDENTICAL predicate the message fan-out in
  -- communication_send_message uses - active staff, an active role, the view
  -- action, super_admin-by-slug, MINUS the deny-only restriction. Filtering on
  -- `s.status` alone froze a denied staff member into this table and delivered
  -- them the notification anyway.
  insert into public.communication_announcement_recipients (announcement_id, staff_id, published_at)
  select p_announcement, s.id, now()
    from public.staff_users s
    join public.staff_role_assignments ra on ra.staff_id = s.id
    join public.roles r on r.id = ra.role_id and r.is_active
    join public.modules mo on mo.key = 'communications.announcements' and mo.is_active
    left join public.role_permissions rp on rp.role_id = r.id and rp.module_id = mo.id
    left join public.staff_permission_restrictions deny on deny.staff_id = s.id and deny.module_id = mo.id
   where s.status = 'active'
     and (r.slug = 'super_admin' or coalesce(rp.can_view, false))
     and not coalesce(deny.deny_view, false)
     and (exists (select 1 from public.communication_announcement_audiences a
                   where a.announcement_id = p_announcement and a.audience_kind = 'all_staff')
       or exists (select 1 from public.communication_announcement_audiences a
                   join public.roles aud_role on aud_role.slug = a.role_slug and aud_role.is_active
                   join public.staff_role_assignments aud_ra on aud_ra.role_id = aud_role.id
                  where a.announcement_id = p_announcement and a.audience_kind = 'role'
                    and aud_ra.staff_id = s.id)
       or exists (select 1 from public.communication_announcement_audiences a
                   join public.departments dp on dp.id = a.department_id and dp.is_active
                  where a.announcement_id = p_announcement and a.audience_kind = 'department'
                    and dp.id = s.department_id)
       or exists (select 1 from public.communication_announcement_audiences a
                   join public.staff_users t on t.id = a.staff_id
                  where a.announcement_id = p_announcement and a.audience_kind = 'staff'
                    and t.id = s.id and t.status = 'active'))
  on conflict (announcement_id, staff_id) do nothing;
  select count(*)::int into v_count from public.communication_announcement_recipients rec
   where rec.announcement_id = p_announcement;
  if v_count = 0 then raise exception 'ANNOUNCEMENT_NO_RECIPIENTS' using errcode = '22023'; end if;
  insert into public.notifications (recipient_staff_id, notification_type, title, summary, entity_type, entity_id)
  select rec.staff_id, 'announcement', v_row.title, 'A new announcement was published.',
         'communication_announcement', p_announcement
    from public.communication_announcement_recipients rec
   where rec.announcement_id = p_announcement
  on conflict (recipient_staff_id, notification_type, entity_id) do nothing;
  update public.communication_announcements a
     set status = 'published', published_at = now(), updated_by = p_actor, updated_at = now()
   where a.id = p_announcement;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (p_actor, 'ANNOUNCEMENT_PUBLISHED', 'communication_announcement', p_announcement::text,
          jsonb_build_object('recipientCount', v_count));
  perform private.complete_mutation(p_actor, 'announcement.publish', p_request_id, v_payload, p_announcement);
  return v_count;
end $$;

create or replace function public.communication_archive_announcement(p_actor uuid, p_announcement uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_row public.communication_announcements%rowtype;
begin
  perform private.mutation_actor_role(p_actor, 'communications.announcements', 'update');
  select a.* into v_row from public.communication_announcements a
   where a.id = p_announcement for update;
  if not found then raise exception 'ANNOUNCEMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status = 'archived' then return; end if;
  if v_row.status <> 'published' then raise exception 'ANNOUNCEMENT_NOT_PUBLISHED' using errcode = '22023'; end if;
  -- Recipients and notifications are left intact: an archived announcement
  -- remains a record of what was communicated.
  update public.communication_announcements a
     set status = 'archived', archived_at = now(), updated_by = p_actor, updated_at = now()
   where a.id = p_announcement;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
  values (p_actor, 'ANNOUNCEMENT_ARCHIVED', 'communication_announcement', p_announcement::text,
          jsonb_build_object('status', 'archived', 'titleLength', char_length(v_row.title)));
end $$;

-- ---------------------------------------------------------------------------
-- 9. Read receipts. Marking read is a personal state change, not a staff
--    capability, so it is authorized by OWNERSHIP and is never audited.
-- ---------------------------------------------------------------------------

create or replace function public.communication_mark_announcement_read(p_actor uuid, p_announcement uuid)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  perform private.mutation_actor_role(p_actor, 'communications.notifications', 'view');
  update public.communication_announcement_recipients rec
     set read_at = now()
   where rec.announcement_id = p_announcement and rec.staff_id = p_actor and rec.read_at is null;
end $$;

create or replace function public.communication_mark_notification_read(p_actor uuid, p_notification uuid)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  perform private.mutation_actor_role(p_actor, 'communications.notifications', 'view');
  -- recipient_staff_id is part of the predicate, so a notification can only
  -- ever be read by the staff member it belongs to.
  -- The SET target is bare: PostgreSQL rejects an alias-qualified SET column
  -- (`set n.read_at`) on the FIRST call, and `create or replace function` does
  -- not validate a plpgsql body, so the invalid statement installed cleanly.
  -- Found by executing this function - nothing had ever called it.
  update public.notifications n set read_at = now()
   where n.id = p_notification and n.recipient_staff_id = p_actor and n.read_at is null;
end $$;

create or replace function public.communication_mark_all_notifications_read(p_actor uuid, p_cutoff timestamptz)
returns int language plpgsql security definer set search_path = public, private as $$
declare
  v_count int;
begin
  perform private.mutation_actor_role(p_actor, 'communications.notifications', 'view');
  -- Bare SET target again: `set n.read_at` is a syntax error, not a style choice.
  update public.notifications n
     set read_at = now()
   where n.recipient_staff_id = p_actor
     and n.read_at is null
     and n.created_at <= coalesce(p_cutoff, now());
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Privileges, one function at a time. Never `on all functions`: the
--     browser roles hold nothing, and a future public function cannot inherit
--     execute by accident.
-- ---------------------------------------------------------------------------

revoke all on function public.communication_visible_messages(uuid,uuid,timestamptz,uuid,integer) from public, anon, authenticated; grant execute on function public.communication_visible_messages(uuid,uuid,timestamptz,uuid,integer) to service_role;
revoke all on function public.communication_unread_counts(uuid) from public, anon, authenticated; grant execute on function public.communication_unread_counts(uuid) to service_role;
revoke all on function public.communication_announcement_feed(uuid,integer,uuid) from public, anon, authenticated; grant execute on function public.communication_announcement_feed(uuid,integer,uuid) to service_role;
revoke all on function public.communication_create_conversation(uuid,text,text,uuid[],uuid) from public, anon, authenticated; grant execute on function public.communication_create_conversation(uuid,text,text,uuid[],uuid) to service_role;
revoke all on function public.communication_add_member(uuid,uuid,uuid) from public, anon, authenticated; grant execute on function public.communication_add_member(uuid,uuid,uuid) to service_role;
revoke all on function public.communication_remove_member(uuid,uuid,uuid) from public, anon, authenticated; grant execute on function public.communication_remove_member(uuid,uuid,uuid) to service_role;
revoke all on function public.communication_archive_conversation(uuid,uuid) from public, anon, authenticated; grant execute on function public.communication_archive_conversation(uuid,uuid) to service_role;
revoke all on function public.communication_send_message(uuid,uuid,text,uuid) from public, anon, authenticated; grant execute on function public.communication_send_message(uuid,uuid,text,uuid) to service_role;
revoke all on function public.communication_mark_read(uuid,uuid,uuid) from public, anon, authenticated; grant execute on function public.communication_mark_read(uuid,uuid,uuid) to service_role;
revoke all on function public.communication_save_announcement(uuid,uuid,text,text,jsonb) from public, anon, authenticated; grant execute on function public.communication_save_announcement(uuid,uuid,text,text,jsonb) to service_role;
revoke all on function public.communication_publish_announcement(uuid,uuid,uuid) from public, anon, authenticated; grant execute on function public.communication_publish_announcement(uuid,uuid,uuid) to service_role;
revoke all on function public.communication_archive_announcement(uuid,uuid) from public, anon, authenticated; grant execute on function public.communication_archive_announcement(uuid,uuid) to service_role;
revoke all on function public.communication_mark_announcement_read(uuid,uuid) from public, anon, authenticated; grant execute on function public.communication_mark_announcement_read(uuid,uuid) to service_role;
revoke all on function public.communication_mark_notification_read(uuid,uuid) from public, anon, authenticated; grant execute on function public.communication_mark_notification_read(uuid,uuid) to service_role;
revoke all on function public.communication_mark_all_notifications_read(uuid,timestamptz) from public, anon, authenticated; grant execute on function public.communication_mark_all_notifications_read(uuid,timestamptz) to service_role;
