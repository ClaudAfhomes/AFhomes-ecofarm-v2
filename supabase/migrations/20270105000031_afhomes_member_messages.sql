-- AF Homes member-staff messages.
--
-- A signed-in member starts a thread (subject + first message) from the portal
-- and replies in it; staff with `communication.messages` read the inbox and
-- reply. A staff reply notifies the member (in-app, plus email when mail is
-- configured). Staff may close a thread; a new member message reopens it.
--
-- Security shape:
-- - Unexposed: `revoke all` from anon/authenticated on both tables, RLS on with
--   NO policy. The portal handler scopes every query to the session's customer;
--   the staff handler authorizes `communication.messages` per request.
-- - `(customer_id, client_request_id)` on threads and
--   `(conversation_id, client_request_id)` on messages are unique, so a retried
--   send never duplicates a message and never reveals another member's thread.
-- - A member message carries no staff id (CHECK). Messages are never edited or
--   deleted.
-- - `private.touch_customer_conversation()` (trigger, SECURITY INVOKER) keeps
--   the thread's last-message time, last sender, read marks and open status in
--   step with each inserted message inside the same statement, so two replies
--   racing cannot leave the thread summary behind the messages.
--
-- Grants: `admin` gets view + update (reply/close). No role gets create
-- (members start threads) or delete.
--
-- forward-only, idempotent: create ... if not exists, create or replace, upserts.
--
-- Validation after apply (expected):
--   select count(*) from public.modules where key = 'communication.messages';         -- 1
--   select r.slug, rp.can_view, rp.can_create, rp.can_update, rp.can_delete
--     from public.role_permissions rp join public.roles r on r.id = rp.role_id
--     join public.modules m on m.id = rp.module_id where m.key = 'communication.messages'; -- admin t/f/t/f
--   select has_table_privilege('authenticated', 'public.customer_conversations', 'SELECT');          -- false
--   select has_table_privilege('authenticated', 'public.customer_conversation_messages', 'SELECT'); -- false
--   select has_function_privilege('anon', 'private.touch_customer_conversation()', 'EXECUTE');      -- false
-- Run supabase/security/rls_invariants.sql (zero AF Homes rows required).
--
-- Down (documentation, not a script): retire the callers first (portal messages
-- page, staff inbox and nav), then in a later migration drop the trigger and
-- function, delete the grant and module row and drop both tables. Export first:
-- these are member correspondence records.
-- No transaction wrapper: the guarded runner commits SQL and migration history together.

insert into public.modules (key, name, group_name, sort_order)
values ('communication.messages', 'Member Messages', 'Communication', 81)
on conflict (key) do update
  set name = excluded.name,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      is_active = true;

insert into public.role_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
select r.id, m.id, true, false, true, false
from public.roles r
cross join public.modules m
where r.slug = 'admin' and m.key = 'communication.messages'
on conflict (role_id, module_id) do update
  set can_view = true, can_create = false, can_update = true, can_delete = false;

create table if not exists public.customer_conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  client_request_id uuid not null,
  subject text not null check (char_length(subject) between 3 and 150),
  status text not null default 'open' check (status in ('open', 'closed')),
  last_message_at timestamptz not null default now(),
  last_sender_kind text not null default 'customer' check (last_sender_kind in ('customer', 'staff')),
  customer_last_read_at timestamptz,
  staff_last_read_at timestamptz,
  closed_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_conversations_request_unique unique (customer_id, client_request_id)
);

create table if not exists public.customer_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.customer_conversations(id),
  client_request_id uuid not null,
  sender_kind text not null check (sender_kind in ('customer', 'staff')),
  sender_staff_id uuid references public.staff_users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  constraint customer_conversation_messages_request_unique unique (conversation_id, client_request_id),
  constraint customer_conversation_messages_sender check (
    sender_kind = 'staff' or sender_staff_id is null)
);

create index if not exists customer_conversations_inbox_idx
  on public.customer_conversations (status, last_sender_kind, last_message_at desc);
create index if not exists customer_conversations_customer_idx
  on public.customer_conversations (customer_id, last_message_at desc);
create index if not exists customer_conversations_closed_by_idx
  on public.customer_conversations (closed_by) where closed_by is not null;
create index if not exists customer_conversation_messages_thread_idx
  on public.customer_conversation_messages (conversation_id, created_at);
create index if not exists customer_conversation_messages_staff_idx
  on public.customer_conversation_messages (sender_staff_id) where sender_staff_id is not null;

create or replace function private.touch_customer_conversation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.customer_conversations c
     set last_message_at = greatest(c.last_message_at, new.created_at),
         last_sender_kind = new.sender_kind,
         -- A member writing again reopens a closed thread; a staff reply keeps
         -- whatever state staff chose.
         status = case when new.sender_kind = 'customer' then 'open' else c.status end,
         closed_by = case when new.sender_kind = 'customer' then null else c.closed_by end,
         -- The sender has, by definition, read the thread up to their message.
         customer_last_read_at = case when new.sender_kind = 'customer'
           then new.created_at else c.customer_last_read_at end,
         staff_last_read_at = case when new.sender_kind = 'staff'
           then new.created_at else c.staff_last_read_at end,
         updated_at = now()
   where c.id = new.conversation_id;
  return new;
end;
$$;

revoke all on function private.touch_customer_conversation() from public, anon, authenticated;

drop trigger if exists customer_conversation_messages_touch on public.customer_conversation_messages;
create trigger customer_conversation_messages_touch
  after insert on public.customer_conversation_messages
  for each row execute function private.touch_customer_conversation();

alter table public.customer_conversations enable row level security;
alter table public.customer_conversation_messages enable row level security;
revoke all on public.customer_conversations from public, anon, authenticated;
revoke all on public.customer_conversation_messages from public, anon, authenticated;
grant select, insert, update on public.customer_conversations to service_role;
grant select, insert on public.customer_conversation_messages to service_role;
