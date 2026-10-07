# AF Homes Communications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Internal staff direct/group chat, targeted announcements and recipient-owned notifications in the existing admin SPA, plus a separate forward-only import seller-validation fix.

**Architecture:** One new Supabase migration (`20261031000001_afhomes_communications_foundation.sql`) adds seven tables behind service-role-only access and `SECURITY DEFINER` RPCs that re-validate the actor. One new `BUSINESS_FAMILIES` router entry dispatches `/api/v1/communications/**` to a single handler that delegates to three `_`-prefixed sub-modules. Conversations are authorized by an append-only membership **interval** model keyed on a per-conversation monotonic `sequence`, so a removed member reads exactly their authorized window and nothing after it. Client side is TanStack Query with polling only.

**Tech Stack:** React 19 + Vite (admin SPA), TanStack Query, Zod contracts, single Vercel Function router, Supabase service-role handlers, Postgres `SECURITY DEFINER` RPCs, `audit_events`, `private.mutation_requests` idempotency.

**Spec:** `docs/superpowers/specs/2026-10-07-afhomes-communications-design.md` — status **APPROVED FOR IMPLEMENTATION PLANNING — 2026-10-07**, with four decisions resolved in its "Approved decisions" section. The spec travels with this plan; executors read both.

---

## Global Constraints

Copy these verbatim into every task's acceptance reasoning.

- **Approved base SHA:** `ce19f95ddfade2e8eaf3c2ac730289c506b5dc28`. Branch `feature/afhomes-communications`.
- **Migration `20261013000001` (#19) is ALREADY APPLIED.** Immutable historical state. Never edit, reapply, rename, or depend on changing it.
- **`20261024000001` is reference only** — absent from live history and from `supabase/migrations/`. Never restore it into the active migration path or apply it wholesale.
- **`20261029000001` is applied.** Recorded history proves nothing about function bodies or managed-stack behavior.
- **New migration versions are reserved, recheck before writing:** `20261031000001_afhomes_communications_foundation.sql` and `20261031000002_afhomes_import_seller_validation.sql`. The local directory currently ends at `20261029000001`, so both are free.
- **Never edit a historical migration file.** New forward-only files only.
- **No new npm dependency.** No realtime library, no socket client.
- **No `any`** in new code. `Db` from `api/_lib/handler-kit.ts` is the only sanctioned loose type.
- **Money/points are not involved.** No float math, no `private.money()` in this feature.
- **Message bodies are plain text**, trimmed, 1–4,000 characters. Never case-folded, never rendered as HTML, never stored in `audit_events`.
- **Every new `api/_handlers/*.ts` file must be literally dynamic-imported from `api/_lib/router.ts`**, or `api/_lib/route-coverage.ts` fails CI. Files whose name starts with `_` are exempt from coverage and are never Vercel functions.
- **Prettier:** `semi`, `singleQuote`, `printWidth: 100`, `trailingComma: all`. CSS Modules per component. Never reformat `docs/`.
- **Server is the only security boundary.** Client route guards and nav filtering are UX.
- **Browser roles (`anon`, `authenticated`) get no privilege on any communications table or RPC.** No `grant execute on all functions`. Per-function `grant execute` to `service_role` only, hardened `search_path`, fully qualified relations.
- **Production deployment is forbidden.** Shared/production migration application is a separate approval (Task 28).

### Approved decisions (human-signed, 2026-10-07)

1. **Employee/GSD** (`employee` slug) may initiate with **all active staff in the same active department**, plus Admin and Super Admin. Not HR/Finance-only. No org-wide discovery. No `gsd` backend role.
2. **OST** may initiate with its **own active authoritative upline chain**, plus Admin and Super Admin. No peer-OST, no downline, no org-wide directory. May reply wherever already an authorized active member.
3. **Group creation** requires `communications.messages` update + an allowed management role + all initial members inside the creator's current eligible scope. The "current group-manager membership" condition applies **only after creation** (add/remove/archive).
4. **Group removal creates exactly one recipient-owned, generic `group_removal` notification.** No message body, no sensitive participant detail, no secrets, no contact details. Following it lands on the conversation in read-only historical mode. It restores nothing.

### Deviation from the spec's API path table (routing evidence)

The spec lists the prefix as `/admin/afhomes/communications`. **That path cannot work.** `api/_lib/router.ts:154-161` matches `^\/api(?:\/v1)?\/admin\/afhomes\/(.+)$` **before** `BUSINESS_FAMILIES` is consulted and dispatches to `api/_handlers/admin/afhomes.ts`, which routes on exact `path` strings and 404s anything unmatched. A family registered under `admin/afhomes/communications` would be unreachable dead code — exactly the silent-404 failure `route-coverage.ts` exists to prevent.

**Plan decision:** register a top-level family, so the API is `/api/v1/communications/**`, matching every other business family (`customers`, `sales`, `redemptions`, …). Every path in the spec's API table keeps its suffix and changes only its prefix. Update the spec's API table prefix in Task 8's commit and note it in the commit body.

---

## Review Focus

Five input classes the spec implies that no task's happy path exercises. Each line names the input, the expected behavior, and the owning task that must carry its test.

1. **A member removed at sequence *N* and re-added at sequence *M* sends nothing, but a message the conversation received during the gap at sequence *(N+M)/2*** — re-add must not retroactively expose the gap message, and the reader's unread count must not include it. Owner: Task 13.
2. **Two members of the same conversation send within the same millisecond** — ordering must still be total and stable, and a cursor taken mid-burst must not skip or duplicate the other message. Owner: Task 13.
3. **A staff member with a null `department_id`** — same-department eligibility must not treat two nulls as equal, so no employee can initiate chat with any other null-department employee. Owner: Task 7.
4. **A Super Admin who is not a member of a conversation** — global role confers no read access to message content, participant lists, or unread counts. Owner: Task 22.
5. **A published announcement's recipient who is later suspended** — the frozen recipient row survives for history, but the notification is unreadable and the feed excludes them. Owner: Task 16.

---

## File Structure

**Created — contracts**
- `packages/contracts/src/schemas/communications.ts` — every request/response Zod schema and inferred type for the family.
- `packages/contracts/src/schemas/communications.spec.ts` — schema-level proofs (unknown-key rejection, bounds, cursor round-trip).

**Modified — contracts**
- `packages/contracts/src/schemas/lifecycle.ts` — add `announcementStatusSchema` (`draft`/`published`/`archived`) + `ANNOUNCEMENT_TRANSITIONS`. Lifecycle stays the single source for status strings.
- `packages/contracts/src/schemas/afhomes.ts` — add three keys to `afHomesModuleKeySchema`.
- `packages/contracts/src/schemas/role-baseline.ts` — baseline grants for the three new keys.
- `packages/contracts/src/index.ts` — `export * from './schemas/communications.js';`

**Created — API**
- `api/_handlers/communications.ts` — default export; dispatches on `req.query.familyPath`.
- `api/_handlers/_communications-conversations.ts` — recipient search, conversation list/detail/create, members, messages, read, archive.
- `api/_handlers/_communications-announcements.ts` — draft CRUD, publish, archive, feed, detail, read.
- `api/_handlers/_communications-notifications.ts` — list, unread count, mark one, mark all.
- `api/_handlers/communications.spec.ts` — handler tests against the in-memory fake.
- `api/_lib/communications-access.ts` — scope derivation, eligible-recipient resolution, group-management predicate.
- `api/_lib/communications-access.spec.ts` — scope matrix proofs.

**Modified — API**
- `api/_lib/router.ts` — one `BUSINESS_FAMILIES` entry, prefix `communications`, module `communications.messages`.
- `api/_lib/routing-contract.spec.ts` — assert the real router reaches the family and that the handler sees the stripped sub-path.

**Created — database**
- `supabase/migrations/20261031000001_afhomes_communications_foundation.sql`
- `supabase/migrations/20261031000002_afhomes_import_seller_validation.sql`
- `supabase/migrations/communications-migration.spec.ts` — text-level migration proofs, colocated per repo convention.

**Modified — database**
- `supabase/db-integration.ts` — new sections 57+ (highest existing is 56; `21. cleanup` runs last and its number is not a new slot).

**Created — admin SPA**
- `apps/admin/src/features/communications/services.ts` — typed API client over `lib/api/client`.
- `apps/admin/src/features/communications/queries.ts` — query keys + `use*` hooks carrying `refetchInterval`.
- `apps/admin/src/features/communications/MessagesPage.tsx` + `.module.css`
- `apps/admin/src/features/communications/AnnouncementsPage.tsx` + `.module.css`
- `apps/admin/src/features/communications/NotificationsPage.tsx` + `.module.css`
- `apps/admin/src/features/communications/NotificationBell.tsx` + `.module.css`
- `apps/admin/src/features/communications/communications.spec.tsx` — UI tests.

**Modified — admin SPA**
- `apps/admin/src/app/navigation.ts` — `Communications` dropdown + longest-prefix `findNavSubItem` already exists and must be relied on.
- `apps/admin/src/app/App.tsx` — routes for the three screens.
- `apps/admin/src/app/AdminLayout.tsx` — mount `<NotificationBell />`.
- `apps/admin/src/app/navigation.spec.ts`, `role-routes.spec.tsx`, `authorization.regression.spec.tsx` — nav/route permission proofs.

**Modified — seller validation**
- `api/_handlers/customer-imports.ts` — map four new SQL error codes to safe HTTP errors.
- `api/_handlers/customer-imports.spec.ts` — add the seller cases.

---

## Task 1: Stabilize the baseline suite (conditional, separate commit)

**Files:**
- Modify: `api/apply-migrations.spec.ts` (two URL fixtures the credential-pattern guard flags)
- Modify: `api/_handlers/phase2-migration.spec.ts` (CRLF-sensitive comment regex)
- Modify: `api/_handlers/phase4-migration.spec.ts` (CRLF-sensitive lock-order assertion)
- Test: the same three files

**Interfaces:**
- Consumes: nothing.
- Produces: a green `pnpm test` baseline that later tasks can trust.

**Context:** the preflight records 3 pre-existing API failures — `customer-security.spec.ts` (credential-pattern guard flags two URL fixtures in `apply-migrations.spec.ts`), `phase2-migration.spec.ts` (comment-stripping regex leaves the word `real` when SQL is CRLF), `phase4-migration.spec.ts` (lock-order assertion expects LF fragments). None are communications defects. Fix them only if they block verification of a later task; otherwise leave them and record them as known baseline.

- [ ] **Step 1: Confirm the failures still reproduce**

Run: `corepack pnpm --filter @jad/api exec vitest run apply-migrations.spec.ts customer-security.spec.ts phase2-migration.spec.ts phase4-migration.spec.ts`
Expected: FAIL on the same three assertions recorded in the preflight. If any passes now, STOP and report — the baseline changed.

- [ ] **Step 2: Fix the CRLF sensitivity without touching historical SQL**

In `phase2-migration.spec.ts` and `phase4-migration.spec.ts`, normalize line endings inside the test's read helper only: replace the literal `/\r?\n/` splitting with `.split(/\r?\n/)` and, where a fragment is asserted, compare against `fragment` after `fragment.replace(/\r\n/g, '\n')`. The assertion target is the *test's* string handling, never the `.sql` file.

- [ ] **Step 3: Fix the credential-pattern fixtures without weakening the guard**

In `apply-migrations.spec.ts`, replace the two offending URL fixture literals with values that do not match the credential pattern. Never edit the guard in `customer-security.spec.ts`; never add an allowlist entry. Run the guard's own tests to prove it still rejects a genuine credential.

- [ ] **Step 4: Run the API workspace suite**

Run: `corepack pnpm --filter @jad/api exec vitest run`
Expected: exit 0, 0 failed files.

- [ ] **Step 5: Commit only if Step 1 reproduced failures**

```bash
git add api/apply-migrations.spec.ts api/_handlers/phase2-migration.spec.ts api/_handlers/phase4-migration.spec.ts
git commit -m "test: stabilize communications baseline checks"
```

**Acceptance:** `vitest run` on the API workspace exits 0, or the task is documented as skipped.
**Security:** the credential-pattern guard must still fail on a real-looking secret. Prove it.
**Rollback:** revert the commit; no product code is involved.
**Dependencies:** none.
**STOP if:** a fix requires editing a file under `supabase/migrations/`, or requires weakening `customer-security.spec.ts`.

---

## Task 2: Communications module keys and role baseline (contracts side)

**Files:**
- Modify: `packages/contracts/src/schemas/afhomes.ts:17-47`
- Modify: `packages/contracts/src/schemas/role-baseline.ts`
- Test: `packages/contracts/src/schemas/role-baseline.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AfHomesModuleKey` gains `'communications.messages' | 'communications.announcements' | 'communications.notifications'` (24 → 27 keys). `BASELINE_GRANTS` in `role-baseline.ts` carries rows for them. Task 4's migration seeds the matching `public.modules` and `public.role_permissions` rows.

**Decision — baseline grants (approved, do not improvise):**

| Role | `communications.messages` | `communications.announcements` | `communications.notifications` |
| --- | --- | --- | --- |
| `admin` | view + create + update | view + create + update | view + update |
| `finance`, `hr` | view + create | view | view + update |
| `vice_director`, `senior_sales_manager`, `sales_manager` | view + create + update | view | view + update |
| `ost` | view + create | view | view + update |
| `employee` | view + create | view | view + update |
| `super_admin` | no row — implicit full access by slug | no row | no row |
| `customer` | no row | no row | no row |

`canDelete` is `false` everywhere: no delete endpoint exists, matching the existing baseline rule.

- [ ] **Step 1: Write the failing baseline test**

In `role-baseline.spec.ts` add:

```
it('grants communications messages create to every operational role', ...)
it('grants communications messages update only to admin, vice_director, senior_sales_manager and sales_manager', ...)
it('grants communications announcements create and update to admin only', ...)
it('grants communications notifications view and update to every operational role', ...)
it('grants no communications module to customer or super_admin', ...)
it('uses only keys present in afHomesModuleKeySchema', ...)
```

Each iterates `BASELINE_GRANTS` and asserts the exact `canView/canCreate/canUpdate/canDelete` tuple for that `(role, module)` pair.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @jad/contracts exec vitest run role-baseline.spec.ts`
Expected: FAIL — `communications.messages` is not a known `AfHomesModuleKey`.

- [ ] **Step 3: Add the three keys**

In `afhomes.ts`, append to `afHomesModuleKeySchema`:
`'communications.messages'`, `'communications.announcements'`, `'communications.notifications'`.

- [ ] **Step 4: Add the baseline rows**

In `role-baseline.ts`, add rows matching the table above using the existing `v`/`vc`/`vu`/`vcu` helpers. Do not add a communications key to `BASELINE_EXCLUDED_MODULES`.

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm --filter @jad/contracts exec vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/schemas/afhomes.ts packages/contracts/src/schemas/role-baseline.ts packages/contracts/src/schemas/role-baseline.spec.ts
git commit -m "feat: add communications module keys and role baseline"
```

**Acceptance:** every one of the eight operational roles resolves exactly its approved tuple; `customer` and `super_admin` have none.
**Security:** a role never gains `canDelete`; `canCreate`/`canUpdate` imply `canView`.
**Rollback:** revert; no DB rows exist yet.
**Dependencies:** none.
**STOP if:** adding a key breaks the existing "only the 24 keys" invariant elsewhere — that invariant is documentation prose in a header comment, not an assertion; update the comment in this commit.

---

## Task 3: Communications contracts

**Files:**
- Create: `packages/contracts/src/schemas/communications.ts`
- Create: `packages/contracts/src/schemas/communications.spec.ts`
- Modify: `packages/contracts/src/schemas/lifecycle.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `AfHomesModuleKey` (Task 2).
- Produces: every type the handlers, services and UI need. Downstream tasks import from `@jad/contracts` only.

**Exported symbols (exact names — later tasks depend on these):**

```ts
// lifecycle.ts
export const announcementStatusSchema = z.enum(['draft', 'published', 'archived']);
export type AnnouncementStatus = z.infer<typeof announcementStatusSchema>;
export const ANNOUNCEMENT_TRANSITIONS: Record<AnnouncementStatus, readonly AnnouncementStatus[]>;

// communications.ts
export const communicationRecipientSchema;        // { id, fullName, roleSlug }
export const communicationConversationSchema;    // { id, kind, title, createdAt, archivedAt, unreadCount, lastMessageAt, lastMessagePreview, historicalOnly }
export const communicationParticipantSchema;     // { staffId, fullName, roleSlug, isManager, active }
export const communicationMessageSchema;         // { id, conversationId, sequence, senderId, senderFullName, body, createdAt }
export const communicationMessagePageSchema;     // { data: communicationMessageSchema[], meta: { nextCursor: string | null } }
export const communicationCreateRequestSchema;   // { kind: 'direct'|'group', title?: string, participantIds: string[], requestId: string }  .strict()
export const communicationAnnouncementSchema;     // { id, title, body, status, createdAt, publishedAt, readAt }
export const notificationSchema;                 // { id, type, title, summary, entityType, entityId, createdAt, readAt }
export const unreadCountSchema;                   // { unread: number }
// request bodies
export const createMessageRequestSchema;          // { body: string (trimmed 1..4000), requestId: uuid }  .strict()
export const markConversationReadRequestSchema;   // { messageId: uuid }  .strict()
export const announcementDraftRequestSchema;      // { title: string (1..200), body: string (1..10000), audiences: audienceInputSchema[] }  .strict()
export const audienceInputSchema;                // discriminated union, exactly one of:
                                                  // { kind: 'all_staff' } | { kind: 'role', roleSlug } | { kind: 'department', departmentId } | { kind: 'staff', staffId }
```

Every request schema is `.strict()` so an unknown mutation field is rejected. `ANNOUNCEMENT_TRANSITIONS` = `{ draft: ['published'], published: ['archived'], archived: [] }`.

- [ ] **Step 1: Write the failing contract tests**

In `communications.spec.ts`:

```
it('rejects an unknown field on createMessageRequestSchema', ...)          // { body, requestId, senderId } -> fail
it('rejects a message body outside 1..4000 after trimming', ...)           // '' and 'x'.repeat(4001) -> fail; '  ok  ' -> 'ok'
it('rejects an announcement audience carrying two discriminators', ...)     // { kind:'role', roleSlug:'admin', staffId: uuid } -> fail
it('rejects an announcement audience carrying no discriminator', ...)       // { kind:'role' } -> fail
it('round-trips a message cursor', ...)                                     // encode -> decode -> identical { conversationId, createdAt, id }
it('rejects a cursor bound to a different conversation', ...)
it('exposes no message edit or delete field', ...)                          // createMessageRequestSchema shape keys
it('never exposes an announcement audience row id to a non-manager', ...)    // communicationAnnouncementSchema shape keys
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @jad/contracts exec vitest run communications.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the schemas**

Write `communications.ts` with the symbols above. Cursor shape: `{ v: 1, conversationId, createdAt, id }`, base64url-encoded JSON, parsed by `messageCursorSchema`. `communicationConversationSchema.historicalOnly` is `true` when the caller's only membership interval is closed — the UI's read-only mode flag.

- [ ] **Step 4: Add the lifecycle strings**

In `lifecycle.ts`, append `announcementStatusSchema`, `AnnouncementStatus`, `ANNOUNCEMENT_TRANSITIONS` beside the existing status schemas.

- [ ] **Step 5: Export from the package index**

In `index.ts` add `export * from './schemas/communications.js';`

- [ ] **Step 6: Run the contracts workspace**

Run: `corepack pnpm --filter @jad/contracts exec vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/schemas/communications.ts packages/contracts/src/schemas/communications.spec.ts packages/contracts/src/schemas/lifecycle.ts packages/contracts/src/index.ts
git commit -m "feat: add communications contracts"
```

**Acceptance:** no `any`; all mutation schemas strict; status strings exist only in `lifecycle.ts`.
**Security:** contracts carry no field that would let a client assert sender, recipient ownership, role, price or timestamp authority.
**Rollback:** revert; nothing consumes these yet.
**Dependencies:** Task 2.

---

## Task 4: Communications foundation migration — tables, grants, module rows

**Files:**
- Create: `supabase/migrations/20261031000001_afhomes_communications_foundation.sql`
- Create: `supabase/migrations/communications-migration.spec.ts`

**Interfaces:**
- Consumes: the three module keys (Task 2) and the baseline table.
- Produces: seven tables with the exact columns below, plus the module/role-permission rows. Task 5 adds the RPCs to the same file.

**Header requirement:** every migration in this repo opens with its validation queries and a down note. Copy the shape from `20261022000001_afhomes_mutation_idempotency.sql`.

**Table contract (exact names — the RPCs and handlers bind to these):**

```
communication_conversations
  id uuid pk default gen_random_uuid()
  kind text not null check (kind in ('direct','group'))
  title text null check (title is null or char_length(btrim(title)) between 1 and 200)
  created_by uuid not null references staff_users(id) on delete restrict
  status text not null default 'active' check (status in ('active','archived'))
  direct_lowest uuid null references staff_users(id) on delete restrict
  direct_highest uuid null references staff_users(id) on delete restrict
  current_sequence bigint not null default 0 check (current_sequence >= 0)
  created_at timestamptz not null default now()
  archived_at timestamptz null
  check ((kind = 'direct' and direct_lowest is not null and direct_highest is not null
          and direct_lowest < direct_highest and title is null)
         or (kind = 'group' and direct_lowest is null and direct_highest is null and title is not null))
  unique (direct_lowest, direct_highest) where kind = 'direct'

communication_conversation_members
  id uuid pk default gen_random_uuid()
  conversation_id uuid not null references communication_conversations(id) on delete restrict
  staff_id uuid not null references staff_users(id) on delete restrict
  is_manager boolean not null default false
  joined_sequence bigint not null check (joined_sequence >= 0)
  left_sequence bigint null check (left_sequence is null or left_sequence > joined_sequence)
  last_read_sequence bigint not null default -1
  last_read_at timestamptz null
  joined_at timestamptz not null default now()
  left_at timestamptz null
  unique (conversation_id, joined_sequence)
  -- one open interval per staff per conversation
  create unique index one_open_interval_per_staff on communication_conversation_members (conversation_id, staff_id) where left_sequence is null

communication_messages
  id uuid pk default gen_random_uuid()
  conversation_id uuid not null references communication_conversations(id) on delete restrict
  sender_staff_id uuid not null references staff_users(id) on delete restrict
  sender_full_name text not null                     -- display snapshot
  body text not null check (char_length(btrim(body)) between 1 and 4000)
  sequence bigint not null check (sequence > 0)
  created_at timestamptz not null default now()
  unique (conversation_id, sequence)
  index (conversation_id, created_at desc, id desc)

communication_announcements
  id uuid pk default gen_random_uuid()
  title text not null check (char_length(btrim(title)) between 1 and 200)
  body text not null check (char_length(btrim(body)) between 1 and 10000)
  status text not null default 'draft' check (status in ('draft','published','archived'))
  created_by uuid not null references staff_users(id) on delete restrict
  updated_by uuid not null references staff_users(id) on delete restrict
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()
  published_at timestamptz null
  archived_at timestamptz null
  check ((status = 'draft' and published_at is null)
         or (status in ('published','archived') and published_at is not null))
  check (status <> 'archived' or archived_at is not null)

communication_announcement_audiences
  id uuid pk default gen_random_uuid()
  announcement_id uuid not null references communication_announcements(id) on delete restrict
  audience_kind text not null check (audience_kind in ('all_staff','role','department','staff'))
  role_slug text null
  department_id uuid null references departments(id) on delete restrict
  staff_id uuid null references staff_users(id) on delete restrict
  check ((audience_kind = 'all_staff'   and role_slug is null and department_id is null and staff_id is null)
      or (audience_kind = 'role'       and role_slug is not null and department_id is null and staff_id is null)
      or (audience_kind = 'department' and role_slug is null and department_id is not null and staff_id is null)
      or (audience_kind = 'staff'      and role_slug is null and department_id is null and staff_id is not null))
  unique (announcement_id, audience_kind, role_slug, department_id, staff_id)

communication_announcement_recipients
  announcement_id uuid not null references communication_announcements(id) on delete restrict
  staff_id uuid not null references staff_users(id) on delete restrict
  published_at timestamptz not null
  read_at timestamptz null
  primary key (announcement_id, staff_id)

notifications
  id uuid pk default gen_random_uuid()
  recipient_staff_id uuid not null references staff_users(id) on delete restrict   -- never null
  notification_type text not null check (notification_type in ('message','announcement','group_removal'))
  title text not null check (char_length(btrim(title)) between 1 and 200)
  summary text not null check (char_length(btrim(summary)) between 1 and 500)
  entity_type text not null
  entity_id uuid not null
  created_at timestamptz not null default now()
  read_at timestamptz null
  unique (recipient_staff_id, notification_type, entity_id)
  index (recipient_staff_id, created_at desc)
  create index notifications_unread on notifications (recipient_staff_id) where read_at is null
```

**Also in this file:**

1. `insert into public.modules (key, name, group_name, sort_order)` for the three new keys, `on conflict (key) do update` — copy the exact upsert shape from `20261001000001_afhomes_phase6_cms_foundation.sql`. `group_name` = `'Communications'`, `sort_order` 110, 111, 112.
2. `insert into public.role_permissions` rows matching Task 2's table exactly, using the same insert shape as `20260930000001_afhomes_role_permission_baseline.sql`. No `super_admin`, no `customer`.
3. **Forward-only widening of the idempotency registry.** `private.mutation_requests.operation` currently has `check (operation in ('payment.create','application.create','reservation.create'))`. Replace it with a superset that also admits `'conversation.create'`, `'message.send'`, `'announcement.publish'`. Drop the old constraint by its generated name (`operation_check` on `private.mutation_requests`), re-add with the wider list, then re-validate existing rows. Do not create a second registry.
4. `alter table … enable row level security` on all seven tables; `revoke all on … from public, anon, authenticated`; `revoke all on all sequences … from public, anon, authenticated`.
5. A table-level comment on each table stating that access is service-role mediated and that browser roles hold no privilege.

- [ ] **Step 1: Write the failing text-level migration test**

In `communications-migration.spec.ts` assert the migration file declares each table, each CHECK above, the three module inserts, the thirteen baseline permission rows, the widened operation check, `enable row level security` on all seven tables, and `revoke all … from public, anon, authenticated` for each. Assert it does **not** contain `execute on all functions`, `grant all`, or a `cascade` delete on any communications table.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @jad/api exec vitest run communications-migration.spec.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write the migration**

Create the file with the header validation queries, then the DDL in the order: module rows → tables → indexes → role permissions → mutation-registry widening → RLS/grants → down note. Every statement idempotent (`if not exists`, `on conflict`, `create or replace`).

- [ ] **Step 4: Run the text test**

Run: `corepack pnpm --filter @jad/api exec vitest run communications-migration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Apply to the disposable database and prove it**

Run: `corepack pnpm test:db:local`
Expected: exit 0; the suite reports one more migration applied than the 38 recorded in the preflight.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261031000001_afhomes_communications_foundation.sql supabase/migrations/communications-migration.spec.ts
git commit -m "feat: add AF Homes communications foundation"
```

**Acceptance:** migration applies cleanly twice from clean; `test:db:local` green; no browser privilege anywhere.
**Security:** `anon`/`authenticated` hold zero privileges; RLS enabled on all seven; no `execute on all functions`; no `cascade` on history tables.
**Rollback:** down note drops the seven tables, the three module rows, the thirteen permission rows, and restores the original three-value operation CHECK. Never roll back by editing an applied file.
**Dependencies:** Task 2.
**STOP if:** `20261031000001` is already present in `supabase/migrations/`; or applying it to the disposable database fails for any reason other than a defect in this file.

---

## Task 5: Communications RPCs

**Files:**
- Modify: `supabase/migrations/20261031000001_afhomes_communications_foundation.sql` (append)

**Interfaces:**
- Consumes: Task 4's tables.
- Produces: every function the handlers call. Signatures are pinned; later tasks must not change them.

**Read functions:**

```sql
public.communication_visible_messages(
  p_actor uuid, p_conversation uuid,
  p_before_created_at timestamptz default null, p_before_id uuid default null,
  p_limit int default 50
) returns table (id uuid, conversation_id uuid, sequence bigint, sender_staff_id uuid,
                sender_full_name text, body text, created_at timestamptz, has_more boolean)
```

Filters by the union of the actor's membership intervals before ordering; `order by created_at desc, id desc`; fetches `p_limit + 1` to set `has_more`.

```sql
public.communication_unread_counts(p_actor uuid)
  returns table (conversation_id uuid, unread bigint, total_unread bigint)
```

One row per conversation the actor is a member of; `total_unread` repeated on every row (handlers take `max()`).

```sql
public.communication_announcement_feed(p_actor uuid, p_limit int default 50, p_before uuid default null)
  returns table (id uuid, title text, body text, published_at timestamptz, read_at timestamptz, has_more boolean)
```

Published announcements only, restricted to the actor's frozen recipient rows, joined to `communication_announcement_recipients.read_at`.

**Mutating functions** (each `security definer`, `set search_path = public, private`, fully qualified relations, `service_role` execute only):

| Function | Returns | Locks, in order |
| --- | --- | --- |
| `communication_create_conversation(p_actor, p_kind, p_title, p_participant_ids uuid[], p_request_id uuid)` | `uuid` | conversation advisory lock on the canonical pair |
| `communication_add_member(p_actor, p_conversation, p_staff)` | `void` | conversation → customer-equivalent: the new member row |
| `communication_remove_member(p_actor, p_conversation, p_staff)` | `void` | conversation → membership row → notification insert |
| `communication_archive_conversation(p_actor, p_conversation)` | `void` | conversation |
| `communication_send_message(p_actor, p_conversation, p_body, p_request_id uuid)` | `bigint` (sequence) | conversation |
| `communication_mark_read(p_actor, p_conversation, p_message_id uuid)` | `void` | conversation → membership |
| `communication_save_announcement(p_actor, p_announcement uuid, p_title, p_body, p_audiences jsonb)` | `uuid` | announcement |
| `communication_publish_announcement(p_actor, p_announcement, p_request_id uuid)` | `int` (recipient count) | announcement → recipients |
| `communication_archive_announcement(p_actor, p_announcement)` | `void` | announcement |
| `communication_mark_announcement_read(p_actor, p_announcement uuid)` | `void` | announcement → receipt |
| `communication_mark_notification_read(p_actor, p_notification uuid)` | `void` | notification |
| `communication_mark_all_notifications_read(p_actor uuid, p_cutoff timestamptz)` | `int` | notifications |

**Lock order is fixed and total: conversation → membership → item/announcement → notification.** Every mutating function begins by re-validating, in SQL: the actor is active in `staff_users`, has an active assigned role, holds the required module action through `private.has_permission()`, is a current member of the conversation, and — for recipient-eligible operations — lies inside the initiator's eligibility scope. A handler bug therefore cannot widen access.

**Interval invariants, enforced in `communication_send_message`:**

**Audit (mandatory, inside the same transaction as the write).** Each mutating function appends to the existing append-only `public.audit_events` using the same insert shape as `api/_lib/handler-kit.ts`'s `audit()` — `actor_id`, `action`, `entity_type`, `entity_id`, `before_data`, `after_data`, `reason`, `request_id`. Audited actions and nowhere else:

| Action | Written by |
| --- | --- |
| `CONVERSATION_CREATED` | `communication_create_conversation` |
| `CONVERSATION_ARCHIVED` | `communication_archive_conversation` |
| `CONVERSATION_MEMBER_ADDED` | `communication_add_member` |
| `CONVERSATION_MEMBER_REMOVED` | `communication_remove_member` |
| `ANNOUNCEMENT_CREATED` / `ANNOUNCEMENT_UPDATED` | `communication_save_announcement` |
| `ANNOUNCEMENT_PUBLISHED` / `ANNOUNCEMENT_ARCHIVED` | `communication_publish_announcement` / `communication_archive_announcement` |

`before_data`/`after_data` carry ids, kinds, status, member ids and interval boundaries only — **never** a message body, an announcement body, a credential, or recipient contact information. Deliberately **not** audited: routine reads, every message read, mark-one/mark-all notification reads, and every individual message send (which stays transactional, generating notifications and sequences without a per-message audit row). A mutation that cannot be audited must not report success, so an audit insert failure aborts the enclosing transaction.

```
-- under the conversation row lock
v_next := communication_conversations.current_sequence + 1;
update communication_conversations
   set current_sequence = v_next
 where id = p_conversation
returning current_sequence into v_seq;

insert into communication_messages (..., sequence, created_at)
values (..., v_seq, greatest(now(), (
  select coalesce(max(created_at), now()) from communication_messages where conversation_id = p_conversation) + interval '1 microsecond'));

update communication_conversation_members
   set left_sequence = v_seq, left_at = now()
 where conversation_id = p_conversation and left_sequence is null and joined_sequence > v_seq;  -- never happens; kept as a guard

insert into notifications (recipient_staff_id, notification_type, title, summary, entity_type, entity_id)
select m.staff_id, 'message', 'New message',
       'A new message was posted in a conversation you belong to.',
       'communication_conversation', p_conversation
  from communication_conversation_members m
  join staff_users s on s.id = m.staff_id
 where m.conversation_id = p_conversation
   and m.left_sequence is null            -- only currently-active members
   and m.staff_id <> p_actor
   and s.status = 'active'
   and private.has_permission(m.staff_id, 'communications.messages', 'view');
```

`communication_remove_member` closes the interval **and** inserts the approved decision-4 notification in the same transaction:

```sql
update communication_conversation_members
   set left_sequence = v_next, left_at = now()
 where conversation_id = p_conversation and staff_id = p_staff and left_sequence is null;

insert into notifications (recipient_staff_id, notification_type, title, summary, entity_type, entity_id)
values (p_staff, 'group_removal', 'Removed from a conversation',
        'You were removed from a group conversation. Earlier messages remain visible to you.',
        'communication_conversation', p_conversation);
```

Exactly one row — guaranteed by `unique (recipient_staff_id, notification_type, entity_id)` combined with an `on conflict do nothing` on the interval-close path.

- [ ] **Step 1: Extend `communications-migration.spec.ts` with the failing assertions**

Assert the file declares each of the fourteen functions, that each mutating one contains `security definer` and `set search_path`, that each contains `private.has_permission(`, that none contains an unqualified `from staff_users` (must be `from public.staff_users`), and that `communication_visible_messages` filters on `joined_sequence` and `left_sequence`.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @jad/api exec vitest run communications-migration.spec.ts`
Expected: FAIL — no functions declared.

- [ ] **Step 3: Append the functions**

Write the read functions first, then mutating in the table's order. Within each mutating function the validation block precedes every write. `communication_create_conversation` computes the canonical pair with `least()`/`greatest()` for direct, uses `private.begin_mutation`/`private.complete_mutation` for `conversation.create`, and rejects `p_participant_ids` containing `p_actor` twice or fewer than one other participant.

- [ ] **Step 4: Run the text test**

Run: `corepack pnpm --filter @jad/api exec vitest run communications-migration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Prove on real PostgreSQL**

Run: `corepack pnpm test:db:local`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261031000001_afhomes_communications_foundation.sql supabase/migrations/communications-migration.spec.ts
git commit -m "feat: add communications RPCs with interval visibility"
```

**Acceptance:** every function re-validates the actor before any write; lock order is the documented one; grants are per-function to `service_role`.
**Security:** no function trusts a supplied sender, recipient ownership, role, status or timestamp. `communication_send_message` and `communication_remove_member` are the only functions that insert notifications.
**Rollback:** `drop function` for each, in reverse dependency order; tables untouched.
**Dependencies:** Task 4.
**STOP if:** any function cannot re-validate authorization in SQL, or if the interval model would require an unlocked read-modify-write.

---

## Task 6: Real-PostgreSQL integration sections

**Files:**
- Modify: `supabase/db-integration.ts` (new sections 57-62)
- Modify: `supabase/db-integration.ts` cleanup set

**Interfaces:**
- Consumes: Tasks 4 and 5.
- Produces: real execution proofs. Section numbers are positional — highest existing is 56, and `21. cleanup` runs last.

**Sections to add:**

- **57. communications schema** — every table exists, RLS enabled, `anon`/`authenticated` have zero grants on all seven tables and on every communications function; `has_table_privilege`/`has_function_privilege` assertions as an impersonated browser role.
- **58. membership intervals** — remove at sequence *N*, re-add at *M*, a message at *(N+M)/2* is invisible to the re-added member; `left_sequence` messages invisible; interval CHECKs reject overlap and double-open.
- **59. message sequence and idempotency** — two sends in one transaction yield strictly increasing sequences and non-decreasing `created_at`; a repeated `requestId` returns the original sequence and inserts no second message; a mismatched payload under the same `requestId` raises a conflict.
- **60. authorization matrix** — as each of the ten roles: unrelated read denied, wrong-department initiation denied, wrong-genealogy initiation denied, Super Admin without membership denied message content, customer denied outright, inactive staff denied even historically.
- **61. announcement publication** — audience union dedupes; empty recipient set rejected; recipients frozen; a post-publish role change does not alter recipients; a suspended recipient is excluded from the feed while the recipient row survives.
- **62. notification ownership** — cross-user read, mark-one and mark-all denied; mark-all leaves concurrently later arrivals unread; `unread` index used by the count query.

Every synthetic row carries the run prefix and joins `createdStaffIds` so cleanup restores pre-run counts — the Phase 5 lesson applies: a cleanup check that inspects one table is not a cleanup check.

- [ ] **Step 1: Add the sections**
- [ ] **Step 2: Run**

Run: `corepack pnpm test:db:local`
Expected: exit 0, and the run's check count strictly greater than the preflight's 1,543.

- [ ] **Step 3: Prove the harness still fails closed**

Run: `corepack pnpm test:db:harness`
Expected: exit 0 for the harness; the normal run green, the injected-fault run non-zero, cleanup verified.

- [ ] **Step 4: Commit**

```bash
git add supabase/db-integration.ts
git commit -m "test: prove communications schema and authorization on PostgreSQL"
```

**Acceptance:** all six sections execute on the successful path, not only in a catch block.
**Security:** browser-role privilege assertions are real `has_*_privilege` calls, not text matches.
**Rollback:** revert; the migration remains applied to the disposable database only.
**Dependencies:** Tasks 4, 5.
**STOP if:** `test:db:harness` does not report the new sections in its normal run output.

---

## Task 7: Authorization helper — recipient scope

**Files:**
- Create: `api/_lib/communications-access.ts`
- Create: `api/_lib/communications-access.spec.ts`

**Interfaces:**
- Consumes: `Db` from `api/_lib/handler-kit.ts`, `AfHomesPrincipal` from `api/_lib/afhomes-access.ts`, `teamStaffIds` from `api/_lib/report-scope.ts`.
- Produces: the scope predicates every handler and RPC cross-check uses.

```ts
export type RecipientScopeKind = 'organization' | 'department' | 'hierarchy' | 'upline' | 'none';

export function recipientScopeKind(principal: AfHomesPrincipal): RecipientScopeKind;
  // super_admin -> 'organization'; admin -> 'organization';
  // finance | hr | employee -> 'department';
  // vice_director | senior_sales_manager | sales_manager -> 'hierarchy';
  // ost -> 'upline'; any other/custom role -> 'none'

export async function eligibleRecipientIds(db: Db, principal: AfHomesPrincipal): Promise<string[]>;
// Always includes principal.userId? NO — excludes self; see the caller contract below.

export async function ancestorsStaffIds(db: Db, staffId: string): Promise<string[]>;
// Active upline walk over referral_relationships. New: report-scope has downline only.

export function canManageGroups(principal: AfHomesPrincipal): boolean;
// true for super_admin | admin | vice_director | senior_sales_manager | sales_manager

export function canPublishAnnouncements(principal: AfHomesPrincipal): boolean;
// true for super_admin | admin
```

**Scope semantics (approved):**

| Scope | Eligible recipients |
| --- | --- |
| `organization` | every active staff user, excluding self |
| `department` | active staff whose `department_id` equals the caller's **and is not null**, plus admin/super_admin, excluding self |
| `hierarchy` | active ancestors **and** active descendants of the caller over active `referral_relationships`, plus admin/super_admin, excluding self |
| `upline` | active ancestors of the caller, plus admin/super_admin, excluding self |
| `none` | admin/super_admin only, excluding self |

Two null departments are **not** equal: a caller with a null department gets only admin/super_admin. `AfHomesPrincipal` carries no department, so read `staff_users.department_id` for the caller with the service client. Use the same BFS shape as `teamStaffIds` including its `out.has(id)` cycle guard and its 10,000-node bound; `ancestorsStaffIds` walks the reverse edge with the same guards.

A custom role's grants confer **no** implicit scope: an unrecognized slug resolves to `'none'` regardless of which modules it holds.

- [ ] **Step 1: Write the failing tests**

```
it('resolves super_admin and admin to organization scope', ...)
it('resolves finance, hr and employee to department scope', ...)
it('resolves vice_director, senior_sales_manager and sales_manager to hierarchy scope', ...)
it('resolves ost to upline scope', ...)
it('resolves an unknown custom role slug to none', ...)
it('excludes the caller from their own eligible recipients', ...)
it('treats two null departments as not equal', ...)          // Review Focus #3
it('treats admin and super_admin as eligible for every scope kind', ...)
it('excludes an inactive staff member from every scope', ...)
it('returns ancestors only for the upline scope', ...)          // no descendants
it('returns ancestors and descendants for the hierarchy scope', ...)
it('terminates on a cyclic referral_relationships edge', ...)
it('does not confer group management to finance, hr, employee or ost', ...)
it('confers announcement publishing to admin and super_admin only', ...)
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @jad/api exec vitest run communications-access.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Follow `report-scope.ts`'s structure exactly: `readSearchRows`, an ordered select, a `Map`, and a bounded queue. Import `teamStaffIds` rather than reimplementing the downline walk.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm --filter @jad/api exec vitest run communications-access.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/communications-access.ts api/_lib/communications-access.spec.ts
git commit -m "feat: add communications recipient scope resolution"
```

**Acceptance:** the eleven-role matrix is proven; self is always excluded; null departments never match.
**Security:** the helper is a *filter*, never an authorization decision on its own — the RPC re-validates. A raw staff id outside the returned set must still fail server-side.
**Rollback:** revert.
**Dependencies:** Task 2.
**STOP if:** eligibility cannot be computed from active `referral_relationships` plus active `staff_users` without reading a retired surface.

---

## Task 8: Router family registration

**Files:**
- Modify: `api/_lib/router.ts` (`BUSINESS_FAMILIES`)
- Modify: `api/_lib/routing-contract.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-07-afhomes-communications-design.md` (API table prefix, documented deviation)

**Interfaces:**
- Consumes: `api/_handlers/communications.ts` (created in Task 9 — create a stub returning 404 in this task so routing is proven first).
- Produces: `GET/POST /api/v1/communications/**` reaching the handler with the family prefix stripped.

- [ ] **Step 1: Write the failing routing test**

In `routing-contract.spec.ts`, go through the real `routeRequest` with the in-memory fake and assert:

```
it('routes GET /api/v1/communications/recipients to the communications family', ...)   // handled === true, not a router 404
it('routes /api/v1/communications/conversations/:id/messages', ...)
it('strips the family prefix before the handler sees the path', ...)                    // familyPath === 'conversations/<id>/messages'
it('does not let /admin/afhomes/communications reach the communications family', ...)   // documents the deviation
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @jad/api exec vitest run routing-contract.spec.ts`
Expected: FAIL — no family matches.

- [ ] **Step 3: Register the family**

Add to `BUSINESS_FAMILIES`, keeping the literal-import rule:

```ts
{
  prefix: 'communications',
  module: 'communications.messages',
  load: () => import('../_handlers/communications.js'),
},
```

Place it after `redemptions` and before `cms`. Create `api/_handlers/communications.ts` as a stub whose default export writes `404` for every path, with a comment pointing at Task 9.

- [ ] **Step 4: Correct the spec's API prefix**

In the spec's "API contracts" table, change the prefix line from `/admin/afhomes/communications` to `/api/v1/communications` and add one sentence recording the routing evidence (router.ts matches `admin/afhomes/*` first).

- [ ] **Step 5: Run the coverage and routing tests**

Run: `corepack pnpm --filter @jad/api exec vitest run route-coverage.spec.ts routing-contract.spec.ts`
Expected: PASS — `findRouteCoverageGaps` reports no gap for `communications.ts`.

- [ ] **Step 6: Commit**

```bash
git add api/_lib/router.ts api/_handlers/communications.ts api/_lib/routing-contract.spec.ts docs/superpowers/specs/2026-10-07-afhomes-communications-design.md
git commit -m "feat: register the communications API family"
```

**Acceptance:** the family is reachable and no coverage gap is reported.
**Security:** the family module key is `communications.messages`; the handler still authorizes per route.
**Rollback:** revert.
**Dependencies:** Task 2.
**STOP if:** route-coverage reports a gap, or the family name collides with an existing prefix.

---

## Task 9: Conversations handler — recipient search, list, detail, direct creation

**Files:**
- Create: `api/_handlers/_communications-conversations.ts`
- Modify: `api/_handlers/communications.ts`
- Test: `api/_handlers/communications.spec.ts`

**Interfaces:**
- Consumes: `communications-access.ts` (Task 7), contracts (Task 3), RPCs (Task 5).
- Produces: `handleConversationsRoute(req, res, subPath): Promise<boolean>` returning `true` when it answered.

Route table for this task:

| Method / sub-path | Behavior |
| --- | --- |
| `GET recipients` | `eligibleRecipientIds` ∩ active staff, projected to `{ id, fullName, roleSlug }` only; bounded by `limit` ≤ 100 |
| `GET conversations` | caller's conversations via `communication_unread_counts` + metadata; newest activity first |
| `GET conversations/:id` | metadata + participants, only if the caller has a membership interval |
| `POST conversations` | `kind='direct'` only in this task |

Naming pinned for later tasks: `GET /announcements` is the **authorized management** list (Task 14); the recipient feed is the separate `GET /announcements/feed` (Task 15). They are never the same response.

**`POST conversations` (direct) rules:** exactly two distinct ids; `participantIds` has length 1 (the other party) for direct; no self-chat; the other party must be in `eligibleRecipientIds`; the RPC's canonical-pair unique constraint means a retry returns the existing conversation, and the handler returns 200 with the existing id rather than 409.

- [ ] **Step 1: Write the failing handler tests**

```
it('returns only eligible recipients for an employee', ...)              // same department + admin/super_admin
it('never returns email, government id or the general staff directory shape', ...)
it('404s a conversation the caller is not a member of', ...)
it('creates a direct conversation with an eligible peer', ...)
it('returns the existing conversation when the same pair is created twice', ...)
it('refuses a self direct conversation', ...)
it('refuses a direct conversation with an ineligible raw staff id', ...)   // raw-ID bypass
it('refuses a customer principal', ...)
it('refuses an inactive staff principal', ...)
it('refuses a principal without communications.messages create', ...)
it('rejects an unknown field in the create body', ...)
```

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm --filter @jad/api exec vitest run communications.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Use `authorizeAfHomes(req, 'communications.messages', 'view' | 'create')`, `subPath(req)`, `route(req, verb, pattern)` and `jsonBody(req)` from `handler-kit.ts`. Map RPC errors with `mapRpcError`. Unknown or unrelated conversation → 404 with no existence disclosure.

- [ ] **Step 4: Run to verify they pass**

Run: `corepack pnpm --filter @jad/api exec vitest run communications.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/_handlers/communications.ts api/_handlers/_communications-conversations.ts api/_handlers/communications.spec.ts
git commit -m "feat: add communications recipient search and direct conversations"
```

**Acceptance:** every refusal above is a real handler response, and the RPC still refuses independently.
**Security:** a raw staff id outside the eligible set is refused server-side; the response never carries email, government id, or department of another person.
**Rollback:** revert; the family returns 404 again.
**Dependencies:** Tasks 3, 5, 7, 8.

---

## Task 10: Group conversation creation

**Files:**
- Modify: `api/_handlers/_communications-conversations.ts`
- Test: `api/_handlers/communications.spec.ts`

**Interfaces:**
- Consumes: `canManageGroups` (Task 7).
- Produces: `POST conversations` with `kind='group'`.

**Rules (approved decision 3):** requires `communications.messages` **update** + `canManageGroups`; title required, trimmed 1-200; 2-50 total active participants; **every** participant including the creator must be in `eligibleRecipientIds`; the creator is auto-inserted as `is_manager = true` at `joined_sequence = 0`; no preexisting-manager-membership check, because the conversation does not exist yet.

- [ ] **Step 1: Write the failing tests**

```
it('creates a group with the creator as manager and member', ...)
it('requires a title for a group', ...)
it('refuses a group with fewer than 2 participants', ...)       // 400
it('refuses a group with more than 50 participants', ...)       // 400
it('refuses group creation without communications.messages update', ...)   // 403 for ost/employee/finance/hr
it('refuses group creation by an ost outside its upline scope', ...)
it('refuses a group containing one ineligible participant', ...)  // raw-ID bypass
it('confines the initial member set to eligible active staff', ...)
it('does not require a preexisting manager membership at creation', ...)  // approved decision 3
```

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement** — extend the existing `POST conversations` branch; kind is read from the parsed body, never from the URL.
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_handlers/_communications-conversations.ts api/_handlers/communications.spec.ts
git commit -m "feat: add group conversation creation"
```

**Acceptance:** `ost`, `employee`, `finance` and `hr` cannot create groups; every initial member is eligibility-checked.
**Security:** creation re-checks `communications.messages` **update**, not just create.
**Rollback:** revert.
**Dependencies:** Task 9.

---

## Task 11: Membership add/remove and the removal notification

**Files:**
- Modify: `api/_handlers/_communications-conversations.ts`
- Test: `api/_handlers/communications.spec.ts`

**Interfaces:**
- Consumes: `communication_add_member`, `communication_remove_member`, `communication_archive_conversation` (Task 5).
- Produces: `POST conversations/:id/members`, `POST conversations/:id/members/:staffId/remove`, `POST conversations/:id/archive`.

**Rules:** post-creation management requires `communications.messages` update + `canManageGroups` + **current manager membership** (approved decision 3). Only the creator is manager in Phase 1; manager transfer is deferred. The creator cannot remove themselves. A repeated remove is idempotent. A group may remain readable with one member after removals. Direct membership is immutable and direct archival is deferred. Archive is manager-only; an archived conversation stays readable within historical intervals but refuses sends and membership changes. No hard delete anywhere.

- [ ] **Step 1: Write the failing tests**

```
it('lets the manager add an eligible member', ...)
it('refuses add when the actor is not a current manager', ...)
it('refuses add of a raw staff id outside the manager eligible scope', ...)
it('closes the interval on remove and creates exactly one notification', ...)
it('creates no second notification on a repeated remove', ...)
it('refuses the creator removing themselves', ...)
it('refuses remove by a non-manager member', ...)
it('refuses membership change on an archived conversation', ...)
it('refuses membership change on a direct conversation', ...)
it('keeps a single-member group readable', ...)
it('archives only as the authorized manager', ...)
```

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_handlers/_communications-conversations.ts api/_handlers/communications.spec.ts
git commit -m "feat: add group membership management and removal notice"
```

**Acceptance:** the removal notification is recipient-owned, generic, and created in the same transaction as the interval close.
**Security:** the notification contains no message body, participant list, contact detail or secret. Following it yields historical read-only access only — proven in Task 22.
**Rollback:** revert; existing intervals are untouched.
**Dependencies:** Task 10.

---

## Task 12: Message send

**Files:**
- Modify: `api/_handlers/_communications-conversations.ts`
- Test: `api/_handlers/communications.spec.ts`

**Interfaces:**
- Consumes: `communication_send_message` (Task 5), `useMutationRequest` on the client side later.
- Produces: `POST conversations/:id/messages`.

**Rules:** requires an active conversation (not archived), `communications.messages` create, and a current membership with `left_sequence is null`. Body trimmed 1-4,000 characters, plain text, never case-folded. `requestId` is a UUID retained across retries; the RPC's `private.begin_mutation` makes a retry return the original sequence with no second message and no second notification wave.

- [ ] **Step 1: Write the failing tests**

```
it('sends a message as a current member', ...)
it('trims the body and stores the trimmed value', ...)
it('refuses an empty or over-length body', ...)
it('refuses a send by a removed member', ...)          // closed interval
it('refuses a send to an archived conversation', ...)
it('returns the original sequence for a retried requestId', ...)
it('rejects a changed payload under the same requestId', ...)
it('does not notify the sender', ...)
it('does not notify a removed member', ...)
it('refuses a forged senderStaffId field', ...)        // unknown field -> 400
```

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_handlers/_communications-conversations.ts api/_handlers/communications.spec.ts
git commit -m "feat: add communications message send"
```

**Acceptance:** one send produces one message, one sequence step, and one notification per other active member.
**Security:** the sender is always `principal.userId`; a supplied sender is never read.
**Rollback:** revert; sent messages are already durable and unaffected.
**Dependencies:** Task 11.

---

## Task 13: Message list, cursor pagination, read state, unread counts

**Files:**
- Modify: `api/_handlers/_communications-conversations.ts`
- Test: `api/_handlers/communications.spec.ts`
- Test: `supabase/db-integration.ts` section 58/59 additions

**Interfaces:**
- Consumes: `communication_visible_messages`, `communication_unread_counts`, `communication_mark_read` (Task 5).
- Produces: `GET conversations/:id/messages`, `POST conversations/:id/read`, and unread counts inside `GET conversations`.

**Rules:** default `limit` 50, max 100; `order by created_at desc, id desc`; the RPC fetches `limit + 1` to set `nextCursor`. A cursor is bound to its conversation and rejected otherwise. **Never** load full history. `POST read` takes a `messageId` that must be a message the caller can actually see, advances the watermark monotonically, and never uses a client clock. Marking a conversation read also marks that caller's own visible message notifications read, inside the transaction. Concurrent later sends stay unread.

- [ ] **Step 1: Write the failing tests**

```
it('returns the newest page first with a nextCursor', ...)
it('caps limit at 100 and defaults to 50', ...)
it('rejects a cursor from another conversation', ...)
it('orders deterministically when two messages share a created_at', ...)      // Review Focus #2
it('never returns a message outside the caller membership intervals', ...)
it('never returns a message from the re-addition gap', ...)                    // Review Focus #1
it('never returns a message after left_sequence', ...)
it('counts unread as non-self messages above the interval watermark', ...)
it('advances the watermark monotonically and ignores a stale mark', ...)
it('refuses a read of a message the caller cannot see', ...)
it('refuses to read an archived-and-removed member future message', ...)
it('marks the caller own message notifications read with the conversation', ...)
it('leaves a concurrent later send unread', ...)
it('excludes historical-only conversations from unread totals', ...)
```

Add to DB sections 58 and 59: the equal-millisecond burst, the gap message after re-add, and watermark monotonicity under two concurrent `communication_mark_read` calls.

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the handler tests** → PASS.
- [ ] **Step 5: Run `corepack pnpm test:db:local`** → exit 0.
- [ ] **Step 6: Commit**

```bash
git add api/_handlers/_communications-conversations.ts api/_handlers/communications.spec.ts supabase/db-integration.ts
git commit -m "feat: add message pagination, read state and unread counts"
```

**Acceptance:** no query path can load unbounded history; ordering is total; a removed member's page is empty beyond `left_sequence`.
**Security:** the watermark advances only through a visible message; the client never supplies a timestamp.
**Rollback:** revert.
**Dependencies:** Task 12.

---

## Task 14: Announcement draft, publish, archive, frozen recipients

**Files:**
- Create: `api/_handlers/_communications-announcements.ts`
- Modify: `api/_handlers/communications.ts`
- Test: `api/_handlers/communications.spec.ts`

**Interfaces:**
- Consumes: `communication_save_announcement`, `communication_publish_announcement`, `communication_archive_announcement` (Task 5), `ANNOUNCEMENT_TRANSITIONS` (Task 3).
- Produces: `GET|POST announcements`, `GET|PATCH announcements/:id`, `POST announcements/:id/publish`, `POST announcements/:id/archive`.

**Rules:** create/update require `communications.announcements` create/update **and** `canPublishAnnouncements` (admin/super_admin) for publish/archive. Only a draft is editable. Publish resolves the audience union over currently-active staff, dedupes, **rejects an empty recipient set** with a validation error, freezes `communication_announcement_recipients`, writes one notification per recipient, and audits — all in one transaction. Published content and audiences are immutable; correction is a new draft plus archive. No scheduled publish, no expiry.

- [ ] **Step 1: Write the failing tests**

```
it('creates a draft announcement with normalized audiences', ...)
it('rejects an audience row carrying two discriminators', ...)
it('rejects publish by a role without announcements update', ...)      // e.g. finance
it('rejects publish by admin without the announcements update grant', ...)
it('resolves the audience union and dedupes a staff member reached twice', ...)
it('rejects publishing to an empty recipient set', ...)
it('freezes recipients at publish', ...)
it('does not add a future joiner to an already published audience', ...)
it('does not rewrite recipients after a post-publish role change', ...)
it('refuses editing a published announcement', ...)
it('archives a published announcement without deleting it', ...)
it('writes exactly one audit event per management action', ...)
it('never stores the announcement body or any message body in audit_events', ...)
it('never exposes a draft to a non-manager recipient query', ...)
```

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_handlers/_communications-announcements.ts api/_handlers/communications.ts api/_handlers/communications.spec.ts
git commit -m "feat: add targeted announcements with frozen recipients"
```

**Acceptance:** recipients are a frozen historical fact; an empty publish is refused rather than silently no-op.
**Security:** publish requires the update grant **and** the admin/super_admin role; audit carries ids and bounded metadata only.
**Rollback:** revert; drafts already published keep their recipients.
**Dependencies:** Tasks 11, 13.

---

## Task 15: Announcement feed, detail and read state

**Files:**
- Modify: `api/_handlers/_communications-announcements.ts`
- Test: `api/_handlers/communications.spec.ts`

**Interfaces:**
- Consumes: `communication_announcement_feed`, `communication_mark_announcement_read` (Task 5).
- Produces: `GET announcements/feed`, `GET announcements/feed/:id`, `POST announcements/:id/read`.

**Rules:** feed and detail are restricted to the caller's own frozen recipient rows. Drafts never appear. Archived announcements are excluded from the feed and from unread counts; a recipient detail request for an archived announcement returns 404 and its notification must not reveal the body. Reading an announcement sets its recipient receipt and the matching notification's `read_at` in one transaction; reading the notification alone does not mark the content read. Management history of archived publications is visible only to authorized managers.

- [ ] **Step 1: Write the failing tests**

```
it('lists only published announcements addressed to the caller', ...)
it('excludes an archived announcement from the feed and unread count', ...)
it('404s an archived announcement for a recipient', ...)
it('never reveals an archived body through its notification', ...)
it('excludes a non-recipient from the feed', ...)
it('never exposes an audience row to a recipient', ...)
it('sets the receipt and the notification read_at together', ...)
it('does not set the receipt when only the notification is read', ...)
it('shows archived history to an authorized manager only', ...)
it('excludes a suspended recipient from the feed while keeping the recipient row', ...)  // Review Focus #5
```

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_handlers/_communications-announcements.ts api/_handlers/communications.spec.ts
git commit -m "feat: add announcement feed and read state"
```

**Acceptance:** a recipient sees only their own published, unarchived announcements.
**Security:** feed membership is `communication_announcement_recipients`, never an audience re-evaluation at read time.
**Rollback:** revert.
**Dependencies:** Task 14.

---

## Task 16: Personal notifications

**Files:**
- Create: `api/_handlers/_communications-notifications.ts`
- Modify: `api/_handlers/communications.ts`
- Test: `api/_handlers/communications.spec.ts`

**Interfaces:**
- Consumes: `communication_mark_notification_read`, `communication_mark_all_notifications_read` (Task 5).
- Produces: `GET notifications`, `GET notifications/unread-count`, `POST notifications/:id/read`, `POST notifications/read-all`.

**Rules:** `recipient_staff_id` is always the caller; every query filters on it in SQL, so a raw id belonging to another user is a 404. Unread count is `where read_at is null` for the caller only. Mark-one is monotonic. Mark-all uses the server transaction cutoff and leaves concurrently later arrivals unread. Notification type is one of `message`, `announcement`, `group_removal` — approved decision 4 adds the third. Following a notification rechecks destination authorization; owning a notification grants no chat or announcement access.

- [ ] **Step 1: Write the failing tests**

```
it('lists only the caller own notifications', ...)
it('404s a notification id belonging to another user', ...)
it('refuses mark-read on another user notification', ...)
it('marks one notification read monotonically', ...)
it('marks all read only up to the server cutoff', ...)
it('counts only the caller unread notifications', ...)
it('returns a generic summary for a group_removal notification', ...)
it('never includes a message body in any notification summary', ...)
it('refuses a customer principal', ...)
it('requires communications.notifications view', ...)
```

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_handlers/_communications-notifications.ts api/_handlers/communications.ts api/_handlers/communications.spec.ts
git commit -m "feat: add recipient-owned personal notifications"
```

**Acceptance:** no cross-user read, mark or count is reachable, including by guessing a UUID.
**Security:** ownership is enforced in SQL, not by filtering after the fetch.
**Rollback:** revert.
**Dependencies:** Task 14.

---

## Task 17: Admin navigation and routes

**Files:**
- Modify: `apps/admin/src/app/navigation.ts`
- Modify: `apps/admin/src/app/App.tsx`
- Test: `apps/admin/src/app/navigation.spec.ts`, `apps/admin/src/app/authorization.regression.spec.tsx`, `apps/admin/src/app/role-routes.spec.tsx`

**Interfaces:**
- Consumes: `AfHomesModuleKey` (Task 2).
- Produces: a `Communications` dropdown with `Messages`, `Announcements`, `Notifications`, each keyed to its own module, plus the three routes.

**Rules:** add nav only now that Tasks 9-16 give working screens — no placeholder entries. `findNavSubItem` already resolves the longest prefix match, which is what makes `/admin/communications` and `/admin/communications/notifications` check different modules; do not reintroduce first-match behavior. Because `roleRoutes` clones every `/admin/*` route for the `employee`, `finance`, `hr` and `sales_manager` staff portals, the three routes must render under those portal prefixes too. Direct URL entry is gated by `RequireRole` with the matching module key; nav hiding is UX only.

- [ ] **Step 1: Write the failing tests**

```
it('shows Communications only when communications.messages is viewable', ...)
it('resolves the Announcements sub-item to communications.announcements', ...)
it('resolves the Notifications sub-item to communications.notifications', ...)   // longest-prefix regression
it('hides the dropdown for a role without any communications grant', ...)
it('blocks a direct URL to Messages without the module permission', ...)
it('blocks a direct URL to Announcements without the announcements permission', ...)
it('blocks a direct URL to Notifications without the notifications permission', ...)
it('serves all three routes under the employee/finance/hr/sales_manager portals', ...)
```

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm --filter @jad/admin exec vitest run navigation.spec.ts authorization.regression.spec.tsx role-routes.spec.tsx`
Expected: FAIL.

- [ ] **Step 3: Add the nav entry and routes**

`{ to: '/admin/communications', label: 'Communications', icon: 'grid', module: 'communications.messages', dropdown: [...] }` following the existing dropdown shape. Routes use `RequireRole` with the matching module key.

- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/app/navigation.ts apps/admin/src/app/App.tsx apps/admin/src/app/navigation.spec.ts apps/admin/src/app/authorization.regression.spec.tsx apps/admin/src/app/role-routes.spec.tsx
git commit -m "feat: add communications navigation and routes"
```

**Acceptance:** a direct URL cannot bypass nav filtering (invariant E).
**Security:** the server still refuses every action regardless of what the nav shows.
**Rollback:** revert; no screen is orphaned because Task 18 has not landed yet.
**Dependencies:** Tasks 2, 9, 14, 16.

---

## Task 18: Admin services and query hooks

**Files:**
- Create: `apps/admin/src/features/communications/services.ts`
- Create: `apps/admin/src/features/communications/queries.ts`
- Test: `apps/admin/src/features/communications/communications.spec.tsx`

**Interfaces:**
- Consumes: contracts (Task 3), `protectedRequest` / `protectedRequestList` / `protectedRequestPage` from `apps/admin/src/lib/api/client.ts`.
- Produces: `communicationKeys` (`['communications', 'conversations']`, `['communications','messages',id]`, `['communications','notifications']`, `['communications','notification-count']`, `['communications','announcements']`) and the `use*` hooks every screen uses.

**Polling (approved):** conversation list `refetchInterval: 15_000`; active conversation `5_000` only while the pane is visible; notifications and unread count `30_000`; announcement feed `30_000`. Follow the existing per-page `refetchInterval` pattern (`MembershipsPage.tsx`, `BusinessFinanceQueuePage.tsx`). Queries are `enabled: false` without a staff session or the matching permission. Mutations invalidate the affected detail/list/count keys — no effect-driven invalidation loop. Preserve last successful data on a transient poll failure with a visible retryable status; an explicit authorization failure clears the protected cached data. Keep the newest page merged with the cursor history, deduplicated by message id.

- [ ] **Step 1: Write the failing hook tests** using `renderWithProviders` from `src/test/utils.tsx` with a fresh retry-free `QueryClient` and `MemoryRouter`.

```
it('polls the conversation list every 15 seconds', ...)
it('polls the active conversation every 5 seconds while visible', ...)
it('stops polling the active conversation when the pane is hidden', ...)
it('polls notifications and the count every 30 seconds', ...)
it('polls the announcement feed every 30 seconds', ...)
it('disables queries without a staff session', ...)
it('preserves last successful data when a poll fails', ...)
it('clears protected cached data on an authorization failure', ...)
it('does not duplicate a message seen in two polls', ...)
it('invalidates the count after a send', ...)
it('does not auto mark-read before a successful render', ...)
```

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm --filter @jad/admin exec vitest run communications.spec.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** `services.ts` and `queries.ts` only. No screens yet.
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/communications/services.ts apps/admin/src/features/communications/queries.ts apps/admin/src/features/communications/communications.spec.tsx
git commit -m "feat: add communications client services and polling hooks"
```

**Acceptance:** every approved interval is exactly as specified; no realtime dependency.
**Security:** every call goes through `lib/api/client`; no ad-hoc `fetch`; no `any`.
**Rollback:** revert.
**Dependencies:** Tasks 3, 16.

---

## Task 19: Messages UI

**Files:**
- Create: `apps/admin/src/features/communications/MessagesPage.tsx`
- Create: `apps/admin/src/features/communications/MessagesPage.module.css`
- Test: `apps/admin/src/features/communications/communications.spec.tsx`

**Interfaces:**
- Consumes: `services.ts` / `queries.ts` (Task 18).
- Produces: `/admin/communications/messages`.

**Scope:** conversation sidebar with unread badges; debounced recipient search through `useDebouncedValue`; direct and group creation; active thread with a load-earlier control driven by `nextCursor`; plain-text composer; retry that keeps the draft and reuses the same `requestId` from `useMutationRequest`; loading/empty/error states; responsive single-pane navigation on mobile. Group controls render only for the authorized manager. A conversation whose membership is closed renders read-only with a clear historical-mode notice. Message bodies render as text nodes, never `dangerouslySetInnerHTML`.

- [ ] **Step 1: Write the failing UI tests** — render, typing, mobile viewport, and the retry/duplicate cases already covered by Task 18:

```
it('lists conversations with unread badges', ...)
it('searches recipients with a 300ms debounce and excludes ineligible staff', ...)
it('creates a direct conversation', ...)
it('creates a group and hides the control from an ost principal', ...)
it('sends a message and keeps the draft on failure while reusing the requestId', ...)
it('loads an earlier page without duplicating messages', ...)
it('renders a removed member conversation read-only with a historical notice', ...)
it('shows group controls only to the manager', ...)
it('renders message text as text, never as HTML', ...)
it('collapses to a single pane on a mobile viewport', ...)
it('exposes an accessible name on every interactive control', ...)
```

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement** with CSS Modules and existing `@jad/ui` primitives.
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/communications/MessagesPage.tsx apps/admin/src/features/communications/MessagesPage.module.css apps/admin/src/features/communications/communications.spec.tsx
git commit -m "feat: add communications messages screen"
```

**Acceptance:** keyboard operable, labelled, mobile single-pane, no duplicated messages across polls.
**Security:** the read-only historical mode is visible and enforced server-side regardless.
**Rollback:** revert.
**Dependencies:** Task 18.

---

## Task 20: Announcements UI

**Files:**
- Create: `apps/admin/src/features/communications/AnnouncementsPage.tsx`
- Create: `apps/admin/src/features/communications/AnnouncementsPage.module.css`
- Test: `apps/admin/src/features/communications/communications.spec.tsx`

**Interfaces:**
- Consumes: Task 18 services/hooks.
- Produces: `/admin/communications/announcements` — staff feed, detail, read state, plus the manager's list, draft editor, audience selector, preview, publish confirmation and archive.

- [ ] **Step 1: Write the failing UI tests**

```
it('shows the staff feed with read state', ...)
it('marks an announcement read on opening it', ...)
it('hides management controls from a role without announcements create', ...)
it('validates a title and body before submitting a draft', ...)
it('adds and removes an audience row without a comma-separated list', ...)
it('previews recipient counts without unrelated staff detail', ...)
it('confirms before publishing', ...)
it('surfaces a rejected empty recipient set', ...)
it('surfaces a safe retry without an indefinite spinner', ...)
```

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/communications/AnnouncementsPage.tsx apps/admin/src/features/communications/AnnouncementsPage.module.css apps/admin/src/features/communications/communications.spec.tsx
git commit -m "feat: add communications announcements screen"
```

**Acceptance:** a non-manager sees the feed only; an empty publish error is legible.
**Security:** management controls are permission-gated client-side *and* refused server-side.
**Rollback:** revert.
**Dependencies:** Task 18.

---

## Task 21: Notifications UI and bell

**Files:**
- Create: `apps/admin/src/features/communications/NotificationsPage.tsx` + `.module.css`
- Create: `apps/admin/src/features/communications/NotificationBell.tsx` + `.module.css`
- Modify: `apps/admin/src/app/AdminLayout.tsx`
- Test: `apps/admin/src/features/communications/communications.spec.tsx`

**Interfaces:**
- Consumes: Task 16 endpoints, Task 18 hooks.
- Produces: `/admin/communications/notifications` and a staff-layout bell showing only the caller's count.

- [ ] **Step 1: Write the failing UI tests**

```
it('renders the bell with an accessible label and the own unread count', ...)
it('hides the bell without a staff session', ...)
it('lists notifications newest first', ...)
it('filters to unread', ...)
it('marks one read and decrements the badge', ...)
it('marks all read and clears the badge', ...)
it('routes a group_removal notification to a read-only historical conversation view', ...)
it('re-checks destination authorization before following a notification', ...)
it('renders the bell accessibly on a small screen', ...)
```

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/communications/NotificationsPage.tsx apps/admin/src/features/communications/NotificationsPage.module.css apps/admin/src/features/communications/NotificationBell.tsx apps/admin/src/features/communications/NotificationBell.module.css apps/admin/src/app/AdminLayout.tsx apps/admin/src/features/communications/communications.spec.tsx
git commit -m "feat: add notifications screen and staff bell"
```

**Acceptance:** the bell shows only the caller's count; a removal notice lands in historical read-only mode.
**Security:** no notification grants access; the destination re-authorizes.
**Rollback:** revert.
**Dependencies:** Task 16.

---

## Task 22: Security regression suite

**Files:**
- Create: `api/_handlers/communications-security.spec.ts`
- Test: same

**Interfaces:**
- Consumes: everything above.
- Produces: the named adversarial proofs.

**Required cases (each a real handler response, no text assertions):**

```
unrelated staff read denied
unrelated staff send denied
raw staff id bypass in recipient search denied
raw staff id bypass in group member add denied
wrong genealogy (an OST addressing its downline) denied
wrong department (an employee addressing another department) denied
ost addressing a peer ost denied
ost addressing the whole organization denied
super_admin without membership denied message content, participants and unread count   // Review Focus #4
customer principal denied on every communications route
inactive staff principal denied, including for historical intervals
removed member denied every post-removal message
re-added member denied the gap messages
notification cross-user read, mark-one, mark-all and count denied
draft announcement hidden from a recipient
archived announcement recipient access denied
wrong role publish denied
customer gains no internal chat: no communications module in the customer session payload
```

- [ ] **Step 1: Write the tests.**
- [ ] **Step 2: Run**

Run: `corepack pnpm --filter @jad/api exec vitest run communications-security.spec.ts`
Expected: PASS immediately if every earlier task held; any FAIL is a real defect in the task that owns that surface — fix it there, not here.

- [ ] **Step 3: Run the whole API workspace**

Run: `corepack pnpm --filter @jad/api exec vitest run`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add api/_handlers/communications-security.spec.ts
git commit -m "test: add communications security regression suite"
```

**Acceptance:** all eighteen cases pass as real responses.
**Security:** this suite is the named evidence for the spec's authorization claims.
**Rollback:** revert.
**Dependencies:** Tasks 9-16.
**STOP if:** any case can only be made to pass by weakening the assertion.

---

## Task 23: Seller-validation migration

**Files:**
- Create: `supabase/migrations/20261031000002_afhomes_import_seller_validation.sql`
- Create: `supabase/migrations/import-seller-validation-migration.spec.ts`

**Interfaces:**
- Consumes: the functions defined in `20261019000002_afhomes_customer_import_jobs.sql` (read-only; never edited).
- Produces: `create or replace function public.import_legacy_member(...)` and `create or replace function public.commit_customer_import_row(...)` with seller validation before any write.

**Rules:** validate before the `card_sales` insert; not for profile-only imports and not for updates that create no sale; no actor-as-seller fallback; no inference from the referral sponsor. Selling-role vocabulary is the existing one: `super_admin`, `admin`, `vice_director`, `senior_sales_manager`, `sales_manager`, `ost`. Error codes: `SELLER_REQUIRED` (missing), `IMPORT_REFERRAL_INVALID` (existing, for unknown/invalid credential), `SELLER_INACTIVE`, `SELLER_ROLE_NOT_A_SELLER`. Preserve the existing complete-hierarchy trigger and the sale-time snapshots. A failed row leaves no customer, sale or ledger residue.

- [ ] **Step 1: Write the failing text test**

Assert the new file contains the four error codes, validates before the insert, does not contain `actor`-as-seller fallback, does not edit `20261019000002`, and keeps the hierarchy trigger and snapshot columns.

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Write the migration** with `create or replace function` for both functions, preserving every existing parameter and return shape exactly.
- [ ] **Step 4: Run**

Run: `corepack pnpm --filter @jad/api exec vitest run import-seller-validation-migration.spec.ts` then `corepack pnpm test:db:local`
Expected: PASS, then exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261031000002_afhomes_import_seller_validation.sql supabase/migrations/import-seller-validation-migration.spec.ts
git commit -m "fix: validate seller attribution during imports"
```

**Acceptance:** a missing seller fails before any write; every previously valid import still succeeds.
**Security:** no silent seller inference from a sponsor.
**Rollback:** re-`create or replace` the prior definitions; never edit `20261019000002`.
**Dependencies:** none from communications. **Must not be committed together with any communications file.**
**STOP if:** `20261031000002` already exists, or the replacement would change a function signature.

---

## Task 24: Seller-validation handler error mapping

**Files:**
- Modify: `api/_handlers/customer-imports.ts`
- Test: `api/_handlers/customer-imports.spec.ts`

**Interfaces:**
- Consumes: the four SQL error codes (Task 23).
- Produces: safe HTTP mappings — `SELLER_REQUIRED` and `SELLER_ROLE_NOT_A_SELLER` → 400 with actionable copy that never echoes staff PII; `SELLER_INACTIVE` → 409; `IMPORT_REFERRAL_INVALID` keeps its existing mapping.

- [ ] **Step 1: Write the failing tests** for each of the four codes, asserting the status and that the message contains no staff id, email or government id.
- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement** in the existing error-mapping path.
- [ ] **Step 4: Run to verify they pass** → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/_handlers/customer-imports.ts api/_handlers/customer-imports.spec.ts
git commit -m "fix: map seller validation errors in the import handler"
```

**Acceptance:** no raw driver message reaches the client.
**Security:** error copy is safe; no PII echo.
**Rollback:** revert.
**Dependencies:** Task 23.

---

## Task 25: Seller-validation tests

**Files:**
- Modify: `supabase/db-integration.ts` (new section 63)
- Test: `api/_handlers/customer-imports.spec.ts`

**Interfaces:**
- Consumes: Tasks 23-24.
- Produces: the full seller matrix.

**Cases:** missing seller; unknown credential; inactive seller; wrong role; valid SM with a complete chain; valid Admin path; a valid supported OST representation permitted by the existing import contract; malformed UUID; retry idempotency; profile-only import creating no sale; update creating no sale. Each failure case additionally asserts **no partial write**: no customer row, no sale row, no ledger row.

- [ ] **Step 1: Add the tests.**
- [ ] **Step 2: Run**

Run: `corepack pnpm --filter @jad/api exec vitest run customer-imports.spec.ts` and `corepack pnpm test:db:local`
Expected: PASS, then exit 0.

- [ ] **Step 3: Commit**

```bash
git add supabase/db-integration.ts api/_handlers/customer-imports.spec.ts
git commit -m "test: cover import seller validation matrix"
```

**Acceptance:** every valid historical import still passes with its verified amounts.
**Security:** no fallback path can attribute a sale to an unintended seller.
**Rollback:** revert.
**Dependencies:** Tasks 23, 24.

---

## Task 26: Full validation run

**Files:** none.

- [ ] **Step 1: Run every gate, in order, and record raw exit codes and counts**

```bash
corepack pnpm typecheck:deploy
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm test
corepack pnpm test:db:local
corepack pnpm test:db:harness
corepack pnpm check:env
```

Plus `supabase/security/rls_invariants.sql` — **empty output = PASS**.

Expected: every exit 0. The preflight's baseline `pnpm test` failed on three API files; Task 1 resolved them. Any remaining failure is a blocker, not a note.

- [ ] **Step 2: Compare against the recorded baseline**

Diff the raw per-workspace counts against `docs/AFHOMES-COMMUNICATIONS-PREFLIGHT.md` and update that document's table with the post-implementation numbers, keeping the original baseline row visible.

- [ ] **Step 3: Commit**

```bash
git add docs/AFHOMES-COMMUNICATIONS-PREFLIGHT.md
git commit -m "docs: record communications implementation validation results"
```

**Acceptance:** eight commands at exit 0 plus a silent RLS invariant run.
**Security:** `check:env` still proves browser/server variable isolation.
**Rollback:** n/a.
**Dependencies:** Tasks 1-25.
**STOP if:** any command exits non-zero. Do not push a red branch.

---

## Task 27: Push the feature branch and prepare Preview

**Files:** none.

- [ ] **Step 1: Review the diff**

Run: `git status --short`, `git diff --name-status claud/develop...HEAD`, `git diff --check`
Expected: only communications files, contracts, admin SPA, the two new migrations, the DB suite and docs.

- [ ] **Step 2: Push without force**

```bash
git push origin feature/afhomes-communications
```

- [ ] **Step 3: Record the Preview outcome honestly**

Preview currently points at the shared database, which does **not** have `20261031000001` applied. Therefore Preview will show the safe "feature unavailable" state, not a working chat. **Record that as NOT VERIFIED for communications UAT.** Do not open a production migration from a Preview observation.

- [ ] **Step 4: Update the preflight** with the real Preview URL/status, the `AUTHENTICATED UAT — PENDING` and `PHYSICAL CAMERA UAT — PENDING` lines unchanged, and a note that managed communications UAT requires an approved schema target.

**Acceptance:** the branch is pushed and the Preview limitation is recorded, not glossed.
**Security:** production deployment stays forbidden.
**Rollback:** n/a.
**Dependencies:** Task 26.

---

## Task 28: Migration-apply review gate — STOP

**Files:** none. This task produces a decision, not a diff.

- [ ] **Step 1: Present for approval, and do nothing without it**

Present the human reviewer with: the exact SQL of `20261031000001` and `20261031000002`, the `test:db:local` output, the DB section results, the RLS invariant result, and the current live migration history read-only.

- [ ] **Step 2: Await explicit written approval** naming the target project ref. Absent that, stop.

- [ ] **Step 3: Only after approval**, apply to the named target with `pnpm db:migrate` against that ref, then run the managed-stack verification: PostgREST reachability, column-grant checks, and a two-user authenticated UAT covering creation, refresh persistence, the removal boundary and publish targeting.

**Acceptance:** an explicit approval naming the project ref exists in the thread.
**Security:** never guess a target; never apply to production unapproved.
**Rollback:** the down note in each migration.
**Dependencies:** Task 26.
**STOP — hard stops for the whole plan:**
- `#19` (`20261013000001`) would need modification.
- `20261024000001` would need restoring or applying wholesale.
- A customer identity would gain any internal chat access.
- The frontend would become the sole authorization boundary.
- Genealogy scope cannot be enforced server-side.
- Browser roles would need broad table access.
- A historical migration would need editing.
- A production migration or deployment would occur without explicit approval.

---

## Commit Boundaries

1. `test: stabilize communications baseline checks` — Task 1 only, optional.
2. `feat: add communications module keys and role baseline` — Task 2.
3. `feat: add communications contracts` — Task 3.
4. `feat: add AF Homes communications foundation` — Tasks 4 and 5 (tables and RPCs are one migration; splitting them across commits would leave an unrunnable intermediate state).
5. `test: prove communications schema and authorization on PostgreSQL` — Task 6.
6. One commit per task 7-22.
7. `fix: validate seller attribution during imports` — Task 23.
8. `fix: map seller validation errors in the import handler` — Task 24.
9. `test: cover import seller validation matrix` — Task 25.
10. `docs: record communications implementation validation results` — Task 26.

**Never** mix a seller-validation file into a communications commit, or vice versa.

## Review Gates

| Gate | After | Reviewer must confirm |
|---|---|---|
| A | Task 5 | Interval visibility and lock order are correct in SQL, not just in prose |
| B | Task 6 | All six DB sections ran on the successful path |
| C | Task 13 | Removed member cannot read past `left_sequence` or the re-add gap |
| D | Task 17 | Direct URL cannot bypass nav permission filtering |
| E | Task 22 | All eighteen adversarial cases are real responses |
| F | Task 26 | Every gate command exited 0 |
| G | Task 28 | Explicit approval naming the target project ref |

## Out of Scope — Deliberately Deferred

Attachments, reactions, message edit/delete, moderation, typing indicators, presence, scheduled publishing, expiry, email/push delivery, group manager transfer, direct conversation archival, a public staff directory, and any customer-facing chat. Do not add them while executing this plan.