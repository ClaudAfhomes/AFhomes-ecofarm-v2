# AF Homes communications — proposed specification

Status: **APPROVED FOR IMPLEMENTATION PLANNING — 2026-10-07.** Four decisions below were resolved by the human reviewer; feature code and migrations are gated on the implementation-execution approval.
Date: 2026-10-07 (Asia/Singapore).
Branch: `feature/afhomes-communications`.
Verified base: `origin/claud/develop` at `ce19f95ddfade2e8eaf3c2ac730289c506b5dc28`.
Both required commits (`790e6a83a62420a2832bd7849c1e5334bc878ad9`, `ce19f95ddfade2e8eaf3c2ac730289c506b5dc28`) are ancestors of HEAD.

## Purpose and boundaries

Deliver internal staff direct/group messaging, targeted announcements and personal notifications through the existing admin SPA. OST and GSD use that SPA with their effective permissions; GSD remains `employee`. Customer-only identities cannot access these endpoints. A dual staff/customer identity has only its independently authorized staff access.

Use React/TanStack Query, the existing REST client, Zod contracts, the single Vercel router, Supabase service-role handlers and `audit_events`. No new dependencies, customer chat, attachments, reactions, message edits/deletes, scheduled publishing, expiry, email/push delivery, or automatic business-workflow notifications.

## Evidence and reference comparison

Current AF Homes evidence: `api/_lib/afhomes-access.ts`, `api/_lib/handler-kit.ts`, `api/_handlers/genealogy.ts`, `api/_lib/report-scope.ts`, `packages/contracts/src/schemas/afhomes.ts`, the mutation-idempotency migration and customer-import migration/handlers. Communications module keys and active communications handlers are absent.

The named remote JadRealty `develop` was inspected read-only through GitHub. References below are behavioral evidence, never executable AF Homes dependencies.

| Jad feature | Observed Jad behavior / source | AF Homes equivalent and change | Implement now |
| --- | --- | --- | --- |
| Threads | `supabase/migrations/20261008000001_messaging.sql`: one admin/member thread keyed by member ID | Staff-owned direct/group conversations with explicit membership intervals; no customer thread | Yes |
| Membership | Staff-wide read helper and member ownership, no group membership table in the messaging migration | Require membership even for Super Admin; no automatic global content access | Yes |
| Send | `api/_handlers/admin/conversations/[memberId]/messages.ts`: text up to 4,000 characters; audit on staff reply | Plain text, active staff authorization, atomic notification generation and request deduplication | Yes |
| Pagination | `api/_handlers/admin/conversations/[memberId].ts`: fetch full history, then paginate by cursor in memory | Apply bounded keyset pagination in PostgreSQL | Yes |
| Read state | Messaging migration maintains per-side watermarks and counters | Per-staff membership watermark; counts derived from eligible messages | Yes |
| Announcements | `api/_handlers/broadcasts.ts`: creates a broadcast Notification with null member ID | Separate draft/published/archived announcement entity with normalized audiences | Yes |
| Audience | Broadcast creation targets all members | All staff, roles, departments, explicit staff IDs | Yes |
| Notifications | `api/_handlers/me/broadcasts.ts`: own plus broadcast feed | One notification per staff recipient; never a null-recipient broadcast | Yes |
| Receipts | `20261007000001_notification_reads.sql`: independent per-member broadcast receipts | Announcement recipient receipt plus personal notification read timestamp | Yes |
| Updates | `apps/admin/src/features/messages/hooks/useMessagesRealtime.ts`: Realtime invalidates authorized API queries | Authorized polling; no browser table privileges or Realtime subscriptions | Yes |
| Admin UI | `apps/admin/src/features/messages/hooks/useConversations.ts`: inbox, infinite thread, mutations invalidate summaries | Shared staff inbox and management controls gated by effective permissions | Yes |
| Audit | `broadcasts.ts` audits BROADCAST_CREATED; staff message handler audits MESSAGE_SENT | Existing AF Homes audit, atomic management events; no routine read audit | Yes |

## Proposed permissions and relationship rules

These are explicit proposals to resolve the request's suggested but incomplete Finance/HR/employee scopes. Approval includes these defaults.

Add only `communications.messages`, `communications.announcements`, and `communications.notifications` to the existing module matrix. Use the current view/create/update/delete actions and deny-only restrictions. No `gsd` role. No customer module grant. Seed grants only for the existing named system roles; unknown/custom roles start denied and require explicit configuration.

| Role | Directory / direct initiation scope | Group management | Announcements | Notifications |
| --- | --- | --- | --- | --- |
| Super Admin | Active staff in organization | Create/manage eligible groups as a member | Full management | Own only |
| Admin | Active staff in organization, subject to effective grants | Create/manage eligible groups as a member | View/create/update/publish/archive if granted | Own only |
| Finance | Active staff in same non-null department, plus Admin/Super Admin | No group creation/member management by default | Targeted published only | Own only |
| HR | Active staff in same non-null department, plus Admin/Super Admin | No group creation/member management by default | Targeted published only | Own only |
| VD | Own active authoritative hierarchy: ancestors and descendants, plus Admin/Super Admin | Create/manage within this scope | Targeted published only | Own only |
| SSM | Own active authoritative hierarchy: ancestors and descendants, plus Admin/Super Admin | Create/manage within this scope | Targeted published only | Own only |
| SM | Own active authoritative hierarchy: ancestors and descendants, plus Admin/Super Admin | Create/manage within this scope | Targeted published only | Own only |
| OST | Active authoritative upline chain only, plus Admin/Super Admin | No group management; explicit eligible invitation allowed | Targeted published only | Own only |
| Employee / GSD | Active staff in the same active department, plus Admin/Super Admin | No group management; explicit eligible invitation allowed | Targeted published only | Own only |
| Customer | No staff directory or internal chat | Denied | Deferred | Deferred; preserve any existing customer behavior |

Message grants: all listed staff roles get view/create for read/send/direct initiation; only Super Admin/Admin/VD/SSM/SM get update for controlled group creation and membership management. No message delete grant. Announcements: staff view; Admin create/update; Super Admin full. Notifications: staff view/update only. Publish/archive require announcement update AND Super Admin/Admin role. **Group creation** requires message update AND an allowed management role AND all initial members inside the creator's current scope — the current-group-manager-membership condition does not apply at creation, because the conversation does not yet exist. **Every other group-management action** (add member, remove member, archive) requires message update AND an allowed management role AND current group-manager membership. A custom role's grants do not silently confer organization-wide relationship scope.

Recipient search returns only eligible active staff with ID/name/role, never the general staff-directory endpoint, emails, government IDs or unrelated hierarchy. Exact-ID mutations use the same server predicate. Initiation authorization uses the initiating manager's scope; recipients may reply through active conversation membership without acquiring directory access to other participants. Members see participant names for their authorized conversation, not searchable organization staff.

Current authoritative active `referral_relationships` determine initiation scope; historical sale snapshots do not. Reuse established hierarchy traversal semantics, exclude inactive/ambiguous/cyclic paths, and re-check in SQL. Department equality requires both departments to exist and be active; two null departments never create eligibility.

Existing conversation membership continues after ordinary hierarchy/department changes; it is an explicit communication authorization. Removal revokes future access. Inactive staff, inactive assigned roles, or effective permission denial revoke all API access immediately. Super Admin has no membership bypass for message contents or notification ownership.

## Direct and group behavior

Direct: exactly two distinct active staff members, canonical unique unordered pair. Retrying creation returns that conversation. Direct membership cannot be edited; no self-chat. Group: creator automatically becomes manager/member, title required, 2–50 total active participants. Initial members and additions must fall within the acting manager's current eligible scope. No self-promotion. Only creator is group manager in this release; manager transfer is deferred. Creator cannot remove themselves. Removed members may be re-added with a new interval, never by reopening the old one. A group may remain readable with one member after removals.

Send requires active conversation, effective message create permission and current membership. Archived conversations remain readable within historical intervals; sending/member changes are refused. Archive is available to the group manager with message update permission; direct archival is deferred. No hard-delete path.

## Membership history and concurrency

All message sends, additions, removals and read-watermark mutations lock the conversation row first. After that lock, use the database's actual current time and allocate a strictly increasing per-conversation sequence. Message `created_at` cannot move backwards relative to the prior message, allowing stable `(created_at,id)` keyset ordering.

Membership records contain `joined_at`, nullable `left_at`, inclusive `joined_sequence`, nullable exclusive `left_sequence`, `last_read_sequence`, `last_read_at`, and member context. Addition sets joined_sequence to the next message sequence; removal sets left_sequence to that same next sequence. Visibility is the union of the caller's intervals: `joined_sequence <= message.sequence` and `message.sequence < left_sequence` when closed. This avoids equal-timestamp and delayed-transaction leaks. Enforce non-overlapping intervals and one active interval per conversation/staff.

Removed users can read only messages from authorized intervals, cannot send, and cannot see future previews, activity timestamps, participant changes or unread counts. Conversations returned to removed users derive preview/order metadata from their last visible message. Re-addition grants no messages sent during the gap. Inactive staff remain denied even for historical intervals.

## Data structure and security

Proposed public tables, each with RLS enabled and ALL privileges revoked from PUBLIC/anon/authenticated:

1. `communication_conversations`: UUID, direct/group, nullable title, creator FK, active/archived, canonical direct-pair fields, current sequence, timestamps. Unique canonical pair for direct conversations; direct/group field consistency checks.
2. `communication_conversation_members`: UUID, conversation/staff FKs, interval boundaries, manager/member context, read watermark. Partial unique active membership; interval constraints.
3. `communication_messages`: UUID, conversation FK, staff sender FK, sender display snapshot, plain body (trimmed 1–4,000 characters), sequence, creation time. Unique conversation/sequence; index `(conversation_id,created_at DESC,id DESC)`.
4. `communication_announcements`: UUID, title (1–200), body (1–10,000), lifecycle, creator/updater FKs, timestamps, publish time.
5. `communication_announcement_audiences`: announcement FK and exactly one audience discriminator: all_staff/role/department/staff with matching nullable FK columns. Unique audience tuples, no comma-separated targeting.
6. `communication_announcement_recipients`: announcement/staff composite key, publication timestamp, nullable read_at. Frozen recipients and independent receipts.
7. `notifications`: UUID, non-null recipient staff FK, type message/announcement/group_removal, title (1–200), bounded generic summary, entity type/UUID, created_at/read_at. Unique `(recipient,type,entity_id)`; recipient/date and partial unread indexes.

FKs restrict deletion of protected history. No cascade removal of messages/membership history. Browser roles get no communication-table SELECT and no communication RPC execution. Service-role access is explicitly scoped to needed tables/functions. No blanket function grant. RPCs use hardened search paths and fully qualified relations, revalidate the server-derived actor's standing, role, effective permission, and resource membership/scope. Never trust supplied sender, recipient ownership, role, status, timestamp, price, or Auth metadata.

Use service-role-mediated read RPCs as needed for interval filtering and bounded pagination. Mutating RPC responsibilities: create/reuse conversation; add/remove group member; send; mark conversation read; save announcement draft; publish/archive; announcement receipt; mark one/all personal notifications read. Each transaction owns its associated audit/notifications. Extend `private.mutation_requests`' existing allowed-operation constraint forward-only for conversation.create/message.send/announcement.publish; reuse its advisory locking, payload fingerprint and result tracking. No second request registry. Revalidate authorization before returning a retry result.

## API contracts

Prefix `/api/v1/communications`, as a top-level router family: `selectHandler` matches `^/api(?:/v1)?/admin/afhomes/(.+)$` before it consults `BUSINESS_FAMILIES`, so an `admin/afhomes/communications` prefix would be swallowed by the admin/afhomes handler and never reach this family. Add literal handler loaders to the existing router. Contracts live in `packages/contracts/src/schemas/communications.ts` and exports; lifecycle strings come from the existing lifecycle authority. All inputs, query parameters and outputs use Zod, with unknown mutation fields rejected. UUID request IDs retained across retry; actor always resolved from staff session. Content stays plain text and is never case-folded or rendered as HTML.

| Method / suffix | Input and result |
| --- | --- |
| GET `/recipients` | Bounded query, eligible recipient ID/name/role page |
| GET/POST `/conversations` | Bounded list; create `{type,title?,participantIds,requestId}` -> conversation |
| GET `/conversations/:id` | Visible conversation metadata and permitted participant display information |
| POST `/conversations/:id/members` | `{staffId}`; authorized group addition |
| POST `/conversations/:id/members/:staffId/remove` | Interval close; idempotent repeat |
| POST `/conversations/:id/archive` | Authorized group archive |
| GET `/conversations/:id/messages` | `cursor?,limit?`; newest-first visible page with nextCursor |
| POST `/conversations/:id/messages` | `{body,requestId}` -> persisted message |
| POST `/conversations/:id/read` | `{messageId}` referencing an actually visible message; advance monotonically, never use client clock |
| GET/POST `/announcements` | Recipient feed or authorized management list; create draft `{title,body,audiences}` |
| GET/PATCH `/announcements/:id` | Scoped detail; update draft content/audiences only |
| POST `/announcements/:id/publish` | `{requestId}`; atomic publish/recipient snapshot/notifications/audit |
| POST `/announcements/:id/archive` | Archive lifecycle; no deletion |
| POST `/announcements/:id/read` | Own frozen-recipient receipt only |
| GET `/notifications` | Own bounded list |
| GET `/notifications/unread-count` | Own unread count |
| POST `/notifications/:id/read` | Own row, monotonic read timestamp |
| POST `/notifications/read-all` | Affect only actor's existing rows at transaction cutoff |

Missing authentication: 401. Inactive/customer-only/wrong permission: 403. Unknown or unrelated resource: 404 without confirming existence. Invalid body/cursor: 400 VALIDATION_ERROR. Request-payload mismatch/lifecycle conflict: repository-standard conflict response. Database failures return safe retryable errors; never raw SQL/PII.

## Pagination, read state and polling

Messages use an opaque versioned cursor containing validated timestamp/UUID, bound to conversation. Database filters by allowed membership intervals before ordering/limit. Default 50, maximum 100, fetch limit+1 for nextCursor. Cursor queries never load full history. Other lists default 25, maximum 100 with stable ordering.

Unread messages count non-self messages in authorized intervals above the per-interval read watermark. Mark read advances only through a visible message the client rendered; concurrent later sends remain unread. Conversation read also marks that recipient's corresponding visible message notifications read in the transaction. Reading announcement sets its recipient receipt and matching notification read; reading its notification alone need not mark announcement content read. Archived announcements are excluded from normal feeds/counts and their unread notifications are retired atomically, retaining history.

TanStack Query polling: conversation list 15s; active conversation 5s while visible; notifications/counts 30s; announcement feed 30s. Pause in background, disable without staff session/permissions, use existing retry policy and logout QueryClient clearing. No new realtime dependency and no Realtime subscription. The read shape (authorized, per-membership scoped, cursor-paginated) is chosen so a future realtime transport can invalidate the same query keys and reuse the same contracts instead of replacing them. No effect-driven invalidation loop. Mutations invalidate affected detail/list/count keys. Preserve last successful data on transient poll failures with a visible retryable status. Explicit authorization failure clears protected cached data. Deduplicate thread page overlap by persisted message ID; keep cursor history while refreshing newest page. No auto mark-read while hidden or before successful render.

## Announcement publication and targeting

Only drafts can be edited. Preview is authorized management-only. Publish locks draft, checks role/update permission, computes the union of currently active eligible staff selected by normalized audiences, freezes recipients, generates one notification per recipient and audits in one transaction. Duplicate audiences create one recipient/notification. Reject empty recipient sets with validation rather than silently publishing. Role and department targeting use current assigned active role/current active department. No future joiners are automatically added to previously published audiences. Audience preview returns counts and permitted displays, not unrelated staff details.

Published content/audiences are immutable in this release; correction uses a new draft and archives old publication. This avoids invisible edits after reading. Recipients retain publication eligibility after role/department changes, but must still be active staff with announcement view permission. Drafts never appear in recipient APIs. Archived publications remain available only in authorized management history; recipient detail returns 404 and notifications cannot reveal their body. No scheduled publication/expiry.

## Notifications and audit

Notifications are generated only for committed new messages to currently active eligible members other than sender, for announcement publication recipients, and for group removal (approved decision 4: exactly one generic, recipient-owned `group_removal` row per removal, created in the same transaction that closes the membership interval; it restores nothing and exposes nothing beyond the conversation id). Summaries are generic (no message body, secrets or sensitive previews). Following a notification rechecks destination authorization; ownership of notification never grants chat/announcement access. Removed/inactive recipients get no future messages or notifications. Mark-all uses only principal identity and server cutoff, leaving concurrently later arrivals unread.

Use existing `audit_events`: conversation created/archived, member added/removed, announcement created/updated/published/archived. Store actor/resource IDs and bounded administrative metadata, never message body, credentials or recipient contact information. No routine read audit. Notification/read/message mutations remain transactional even without per-message audit. No moderation in this release.

## UI

Admin navigation: Communications > Messages / Announcements / Notifications, introduced only with working routes and matching RequireRole module checks. Same permission model for all staff. Bell lives in staff layout, shows own count and links to own notifications; accessible label, keyboard interaction and small-screen layout.

Messages: conversation sidebar with unread badges, scoped recipient search, controlled group creation, message pane with load-earlier control, plain-text composer, retry retaining draft/requestId, send state, loading/empty/error states and responsive single-pane navigation on mobile. Group controls visible only to authorized manager; removed-member historical mode is read-only.

Announcements: staff feed/detail/read state; management list, draft editor, normalized audience selector, preview counts/content, publish confirmation and archive. Show safe retry and no indefinite loading. Notifications: list, unread filter/count, mark-one/all, permission-checked destination link. Use CSS Modules, shared UI primitives and existing API client; no ad-hoc fetch.

## Separate import seller-validation fix

Create a separate forward-only migration replacing the current import function definitions without editing `20261019000002`. Validate before sale creation, not for profile-only imports or updates that create no sale. No actor-as-seller fallback and no inference from referral sponsor when seller credential is missing.

`import_legacy_member`: require sellerStaffId when creating card_sales; resolve active staff and active assigned role; apply existing selling-role vocabulary (`super_admin`, `admin`, `vice_director`, `senior_sales_manager`, `sales_manager`, `ost`). Preserve existing complete-hierarchy trigger and sale-time snapshots. Do not invent a new seller type or commission for legacy sales.

`commit_customer_import_row`: before CREATE-with-sale, require explicit raw seller credential, use existing referral-code resolution validity rules, then validate active staff/allowed seller role. Missing -> SELLER_REQUIRED; unknown/invalid credential -> existing IMPORT_REFERRAL_INVALID; inactive -> SELLER_INACTIVE; wrong role -> SELLER_ROLE_NOT_A_SELLER. Add safe domain error mappings in handler; validation must precede writes and failed rows leave no customer/sale/ledger residue.

Tests: missing/unknown/inactive/wrong-role seller, valid SM with complete chain, valid Admin path, valid allowed OST representation supported by existing import contract, malformed UUID, retry, customer-only import and no-sale update unchanged. Preserve all existing valid import tests and verified historical amounts.

## Migration discipline and live discrepancy

Local latest migration: `20261029000001_afhomes_operational_access_functions.sql`. Read-only `list_migrations` and exact SELECT from `supabase_migrations.schema_migrations` on `ikaevepedpqygdlipsei` show `20261013000001` (#19) ALREADY APPLIED in live migration history. Treat it as immutable historical state: do not modify, reapply, rename, or depend on changing it. Any earlier dated report in `docs/` describing #19 as unapplied records the state before that application and is left as a point-in-time record. `20261029000001` is recorded; `20261024000001`, `20261030000001`, `20261031000001`, `20261031000002` absent. Recorded history does not prove function bodies or managed-stack behavior.

Proposed reserved versions, recheck before creation: `20261031000001_afhomes_communications_foundation.sql`; `20261031000002_afhomes_import_seller_validation.sql`. Each is idempotent with validation queries/down note. No dependency on #19, no change/apply/rename of #19, no historical migration edits, no wholesale application of 20261024000001. That communications reference file is absent from current migration directory; locate an authorized historical reference during planning if needed, never restore it into the active migration path.

No shared database migration, production deployment or seed this phase. Local disposable PostgreSQL may apply checked-in history as part of the required harness, distinct from shared migration application. Preview using the existing shared database cannot prove the new schema until separately approved migration application; it must show a safe unavailable-feature state, not claim communications UAT PASS. Prefer an explicitly approved isolated development target for real acceptance. Do not create/configure a remote DB without approval.

## Verification and release gates

Before implementation, preserve full baseline and raw per-workspace counts. Implement with focused red/green security and integrity checks using existing harnesses. No reviewer agents requested; review inline.

Required API and SQL cases: unrelated user read/send denied; removed intervals exclude future/gap messages including equal-time/concurrent cases; customer/anon/inactive staff denied; genealogy/department scope cannot be bypassed by raw IDs; group additions/removal/send serialize correctly; Super Admin still needs membership; draft/archived feed restrictions; role/user/department audience union; wrong-role publish denied; personal notification read/count/mark-all ownership; request retry exactly once and payload conflict; pagination tie-break/no unlimited fetch; constraints/FKs/indexes/narrow table/RPC grants and RLS.

UI checks: send retry, no duplicate polled messages, unseen arrival remains unread, correct invalidation, non-destructive failed poll, bounded intervals, background/session shutdown, permission-consistent nav/direct routes, customer portal unchanged. Run full requested typecheck:deploy/typecheck/lint/build/test/test:db:local/test:db:harness/check:env/diff checks, RLS invariant SQL and exact raw counts. Real authenticated UAT includes creation, refresh persistence, two users, removal boundary, publish targeting and runtime errors on an approved managed target.

Commit only explicit feature files after approved implementation and passing checks; separate communications and import commits. Push only feature branch and report actual Preview URL/status. Production deployment forbidden. Authenticated UAT and physical camera UAT remain PENDING until actually performed.

## Approved decisions (human, 2026-10-07)

These four resolved the OPEN DECISIONS raised in the previous revision. They are FINAL unless implementation evidence reveals a hard technical contradiction.

1. **Employee/GSD chat scope.** GSD keeps the technical slug `employee`. It may initiate chat with **all active staff in the same active department**, plus Admin and Super Admin. It is NOT limited to HR/Finance, and it gains no organization-wide staff discovery. No `gsd` backend role is introduced.
2. **OST chat scope.** OST initiation remains its **own active authoritative upline chain**, plus Admin and Super Admin. No peer-OST discovery, no downline discovery, no organization-wide directory. OST may reply in any conversation where it is already an authorized active member.
3. **Group creation rule.** Group creation requires `communications.messages` update, an allowed management role, and every initial member inside the creator's current eligible scope. The "current group-manager membership" condition does **not** apply at creation, because the conversation does not yet exist; it applies only afterwards, to add member, remove member, archive and every other group-management action.
4. **Group removal notification.** An active staff member removed from a group receives exactly **one** recipient-owned, generic `group_removal` notification. It carries no message body, no sensitive participant information, no secrets and no contact details. Following it opens the conversation in **read-only historical mode** and restores nothing: no membership, no future messages, no post-removal participant changes, no post-removal unread counts.

## Approval requested

Review the proposed department scopes, manager rules, membership persistence after hierarchy changes, frozen publication recipients, immutable published announcements, and Preview/database limitation. Approval of this written spec permits writing the implementation plan; feature code and migrations remain gated by the requested review process.
