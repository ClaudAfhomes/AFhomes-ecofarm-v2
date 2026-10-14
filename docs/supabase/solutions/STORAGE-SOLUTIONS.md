# AF Homes: Supabase solutions — Phase 4 (File Storage control + public URL media)

Updated: 2026-10-14 (Asia/Singapore). Status: implementation plan — **not yet implemented**. This document turns the File Storage rules in `docs/supabase/SUPABASE-FREE.md` into concrete, AI-executable work, combined with the approved public-media direction (external video/photo URLs for public content, 0.5 MB stored size for profile images). `docs/supabase/SUPABASE-FREE.md` remains the single reference for quota and accounting; `docs/supabase/solutions/EGRESS-SOLUTIONS.md` is Phase 1 (egress); `docs/supabase/solutions/DATABASE-SOLUTIONS.md` is Phase 2 (database size); `docs/supabase/solutions/MAU-SOLUTIONS.md` is Phase 3 (MAU); `docs/supabase/solutions/LOG-SOLUTIONS.md` is Phase 5 (log ingestion); `docs/supabase/solutions/LOG-QUERY-SOLUTIONS.md` is Phase 6 (log query). Repository code, migrations and `AGENTS.md` remain authoritative for application behavior. Do not create parallel capacity documents — update this file as phases ship.

> **Instruction to the implementing AI:** execute the tasks below in order of the priority section. Part A tasks are mostly hygiene and policy; Part B tasks are new features requiring migrations, contracts, tests and explicit approval. Never combine two tasks in one commit when a task touches authorization, Auth settings, money or contracts. For every task: run the full command set in "Verification" before claiming completion, and report evidence (command output), not intentions.

## Phase 4 goal

Keep File Storage far from the Free-plan **1 GB** quota while adding two approved capabilities: (a) external video/photo URLs for **public, non-private content only** (CMS marketing and all other public files), and (b) profile images at **0.5 MB stored size** in both public and private classes. Private identity documents and payment receipts **never** leave private Storage. The measured levers are **stored bytes averaged over the billing cycle (GB-Hrs)** and **object count growth**.

Read this first: `docs/supabase/SUPABASE-FREE.md` — budget table, growth policy, checkpoints. Everything below builds on rules already stated there; it does not replace them.

## What File Storage is (context the AI must assume, verified 2026-10-14)

* Free quota: **1 GB**, billed as **Gigabyte-Hours (GB-Hrs)** — 744 GB-Hrs on Free. Usage is the **average across the billing period, not the live size**: storing 1 GB for the first half of the month and 0 for the second averages to 0.5 GB. Consequence: **late-cycle cleanup barely helps immediately** — a restriction may persist until the next cycle begins. Plan cleanups early; never panic-delete. [Manage Storage size usage](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size).
* Org-wide ("usage of all projects by default" on the Dashboard, with per-project filter). Free exceed: notification + grace period under the Fair Use Policy, not an automatic charge. Pro: 100 GB at $0.0213/GB/month overage.
* Official optimizations from Supabase: **limit the upload size per bucket** + **delete assets no longer in use**.
* Per-bucket SQL (official pattern) for measurement:
```sql
select bucket_id,
       (sum((metadata->>'size')::int) / 1048576.0)::numeric(10, 2) as total_size_megabyte
from storage.objects
group by bucket_id
order by total_size_megabyte desc;
```
* Metadata snapshots are estimates; the Dashboard is authoritative.

## Repo baseline (facts, not proposals)

* **5 buckets**: `afhomes-customer-ids`, `afhomes-ost-ids`, `afhomes-payment-receipts` (all private, **10 MiB cap**, jpeg/png/pdf — `20260926023325_afhomes_phase1_foundation.sql:371-375`); `afhomes-cms-media` (**public**, 10 MiB, jpeg/png/webp/gif + **video/mp4** — `20261001000001_afhomes_phase6_cms_foundation.sql:136-144`); `afhomes-service-images` (private, **no explicit `file_size_limit`** — `20261111000000_afhomes_service_publication.sql:13`).
* Server-issued **signed upload grants** (`createUploadGrant` in `api/_handlers/documents.ts`) with structured paths (`<bucket>/customer/{id}/{uuid}.jpg`) and `expiresAt`; the DB row is created at grant issuance and carries `sha256`.
* Existing object removal: `api/_handlers/_service-refunds.ts:116` removes receipt objects. Snapshot 2026-10-13: **0 recorded objects** — this phase is prevention plus approved new features, not emergency cleanup.
* Profile photos are now implemented locally in `b36d216` for private account use, with browser compression, a 500,000-byte cap and one overwritten object per Auth identity. The bucket migration is still unapplied; live upload/download acceptance is pending. See [current release evidence](../SUPABASE-FREE.md#profile-photos-local-implementation-and-release-boundary-2026-10-14). Public-profile publication remains a separate Part B scope. No URL-media feature exists: YouTube appears only as a social link.
* Approved scope (user decisions 2026-10-14): URL media covers **CMS marketing and all public non-private files**; video accepts **YouTube + Facebook + TikTok**; profile images exist in **both public and private** classes.

## Non-negotiable guardrails (do not violate in any task)

1. Identity documents and payment receipts stay in private buckets with hash verification and signed delivery. **No URL alternative, no public bucket, no external host for private files — ever.**
2. Never weaken RLS, bucket policies, column grants, `has_permission` or ownership checks to save bytes.
3. The server **never fetches arbitrary user-supplied URLs** (SSRF). Browsers load external media directly; the server validates format only.
4. Never store raw embed HTML from users. The renderer builds embeds from `platform + embed_id` alone.
5. Never put files (base64) into Postgres to "save storage" — that moves the problem to the Phase 2 meter.
6. Never delete financial records, receipts, required audit history or superseded identity history without written approval. Every cleanup needs ownership + dependency checks, an audit entry and a dry run first.
7. Never silently block onboarding uploads; never create a second project/bucket as a quota workaround; never delete objects directly in the Dashboard without DB reconciliation.
8. The 0.5 MB profile rule is **stored size after compression, not an input cap**. Lowering a bucket cap to 0.5 MB without a compression pipeline blocks valid phone-camera onboarding and is forbidden.
9. Migration discipline: one idempotent `afhomes_`-prefixed migration per change, forward-only, validation queries in the header, down note. URL/media contract changes go through `@afhomes/contracts`; input rules live in the shared input schema (URLs are never case-folded per repo rules).

## Solution inventory at a glance

| # | Solution | Part | Tier | Needs migration | Needs approval |
| --- | --- | --- | --- | --- | --- |
| 1 | Measure Storage (Dashboard GB-Hrs + per-bucket SQL) | A | Foundational | No | No |
| 2 | Bucket limits audit (`service-images` cap, verify all) | A | Foundational | Yes | Yes |
| 3 | Client pre-checks + server byte verification | A | Foundational | No | No |
| 4 | Structured paths + server-generated grants only | A | Foundational | No | No |
| 5 | `sha256` dedupe + same-grant retry reuse | A | Foundational | No | No |
| 6 | CMS media discipline (video policy) | A | Foundational | No | Yes (policy) |
| 7 | Reconciliation dry run (orphans vs dangling rows) | A | Foundational | No | No |
| 8 | Retention policy per class | A | Policy | Maybe | Yes |
| 9 | Compression proposal (preview + legibility tests) | A | Advanced | No | Yes |
| 10 | Public URL media model + per-platform validators | B | Feature | Yes | Yes |
| 11 | Embed renderer + moderation flow | B | Feature | No (code) | Yes |
| 12 | Profile buckets (public + private) + 0.5 MB pipeline | B | Feature | Yes | Yes |
| 13 | Existing removal-path audit | A | Foundational | No | No |
| 14 | External archival tiering (cold objects) | A | Future | Yes | Yes |

---

## Part A — File Storage control checklist

### Task 1 — Measure Storage [Foundational, no migration]

- [ ] Record Dashboard org Storage size (GB-Hrs, all projects default view), then the per-project filtered value, plus cycle dates.
- [ ] Run the per-bucket totals SQL and the files-larger-than-5 MB listing (official pattern) as read-only; never read document contents.
- [ ] Note the GB-Hrs nuance in the report: early-cycle cleanup moves the average; late-cycle cleanup may not clear a restriction until next cycle.
- [ ] Re-run monthly and after any Task 2/5/8/12 change.

### Task 2 — Bucket limits audit [Foundational; cap change needs migration + approval]

- [ ] Verify every bucket row: `public`, `file_size_limit`, `allowed_mime_types`. `afhomes-service-images` currently has **no explicit cap** — propose one by migration.
- [ ] Keep the 10 MiB caps and mime allowlists on the identity/receipt/CMS buckets unless a measured proposal changes them.
- [ ] Server-side actual-byte verification after upload stays mandatory — declared size at grant time is not proof.

### Task 3 — Client pre-checks + server verification [Foundational, no migration]

- [ ] Browser checks size/type **before** requesting a grant, so invalid files never consume grants, rows or bytes.
- [ ] Server re-verifies actual bytes and mime on confirm; reject on mismatch. No trust in client-declared sizes.

### Task 4 — Structured paths + server grants only [Foundational, no migration]

- [ ] Preserve the existing pattern: server generates bucket + object path (`<bucket>/<scope>/{id}/{uuid}.{ext}`); clients never choose bucket or path.
- [ ] Grants carry short expiry; confirm path matches the grant before creating the final row.

### Task 5 — `sha256` dedupe + retry reuse [Foundational, no migration]

- [ ] Reuse the existing `identity_documents.sha256`: same file (same hash, **same subject/purpose**) re-uploaded via double submit, retry or re-grant **reuses** the existing object/row instead of storing a second copy.
- [ ] Same-session retry reuses the same grant/path while unexpired — a fresh grant per retry (fresh UUID name) is how duplicates are born.
- [ ] Never dedupe across different customers (privacy isolation). Add specs for double-submit, expired-grant retry and cross-subject non-dedupe.

### Task 6 — CMS media discipline [Foundational; policy needs approval]

- [ ] `afhomes-cms-media` is public and accepts `video/mp4` — the largest storage risk because it serves publishing, not identity. Policy: images default; video only when approved; cap media count per page.
- [ ] Public delivery stays read-only; uploads/deletes stay server service-role (existing pattern).
- [ ] Part B URL media (Tasks 10–11) is the preferred outlet for large public video — propose URL first, bucket upload second.

### Task 7 — Reconciliation dry run [Foundational, no migration, no deletions]

- [ ] Compare `storage.objects` against `identity_documents.storage_path`, `cms_media_assets.storage_path` and payment `receipt_storage_path`; report three classes: **orphan objects** (no DB row — abandoned uploads), **dangling rows** (row but no object — abandoned grants), **superseded files** (replaced history).
- [ ] Report only. Any deletion moves to Task 8 with approval.

### Task 8 — Retention policy per class [Policy; execution needs approval]

- [ ] Define per class — abandoned upload grants/objects (safest), superseded identity rows/objects (history by design — changing that is a company decision), payment receipts (financial — keep or archive, never delete), CMS versions, OCR intermediates: owner, window, dependency check, mechanism (dry run first), audit trail.
- [ ] Produce the policy for company approval. Execute only as dry run → review → approved run, each with an `audit_events` record. Archiving (if approved) needs access controls, tested retrieval and restore — deletion is not archiving.

### Task 9 — Compression proposal [Advanced; needs approval, no migration until approved]

- [ ] Per `SUPABASE-FREE.md` (proposed, not approved): compress/downscale suitable image scans only with a readable user-approved preview and tests protecting OCR/identity legibility. Never blind-PDF-recompress, never drop pages, never block valid onboarding. EXIF strip included (privacy + bytes).
- [ ] If approved, it feeds the Task 12 profile pipeline; otherwise Task 12 waits.

### Task 13 — Existing removal-path audit [Foundational, no migration]

- [ ] Audit every `remove()` call site (known: `_service-refunds.ts` receipt removal): each has an audit trail and leaves no dangling row. Fix gaps with tests.

### Task 14 — External archival tiering [Future; migration + approval]

- [ ] For cold objects (old scans, closed records): detach to approved cheap storage (R2/S3), keep the reference ID in Postgres. Needs export job, tested retrieval, restore process, access controls, one authoritative writer. Same pattern as Phase 2 archival — do not build speculatively.

## Part B — Public URL media + profile images checklist

### Task 10 — Public URL media model + validators [Feature; migration + approval]

- [ ] New public-media record (one migration): `visibility = 'public'`, `media_kind` (video/image), `platform` (`youtube`/`facebook`/`tiktok`/`direct-image`), `source_url` (original, stored verbatim, never rewritten), `embed_id` (extracted video ID — the only trusted renderer input), `storage_path` nullable for bucket-backed public media, submitted_by/approved_by + audit.
- [ ] Scope enforced in code and SQL: public surfaces only (CMS marketing + other public non-private files). Any attempt to attach a URL to an identity/receipt/private row is rejected.
- [ ] Validators in shared contracts/input schema: https-only; reject `javascript:`/`data:`/non-http(s); per-platform extraction — YouTube (`watch?v=`, `youtu.be/`, `/shorts/` → 11-char ID), Facebook (`/.../videos/<id>`, `fb.watch/<token>`), TikTok (`/@user/video/<id>` numeric); direct-image requires https + image extension or known host. URLs never case-folded.
- [ ] Specs per platform: valid variants accepted, malformed/mixed-case-host/spoofed IDs rejected, embed HTML in input rejected.

### Task 11 — Embed renderer + moderation [Feature code; flow needs approval]

- [ ] Renderer builds from `platform + embed_id` only: YouTube via `youtube-nocookie` sandboxed iframe, no autoplay; Facebook via official embed iframe path (no arbitrary SDK params); TikTok via blockquote + platform script with a no-JS fallback link; images `loading="lazy"` with constrained width and an on-error fallback.
- [ ] Moderation flow: submit → approve → publish, with audit entries. No direct-to-published user URLs.
- [ ] Image hosts: allowlist (recommended) — record the decision; open-any-https requires explicit sign-off because moderation load becomes unbounded.
- [ ] External loads cost zero Supabase storage and zero Supabase egress — record measured bytes avoided per fixture in the report.

### Task 12 — Profile buckets + 0.5 MB pipeline [Feature; migration + approval]

- [ ] Two new buckets (one migration): `afhomes-profile-public` (public, like cms-media) and `afhomes-profile-private` (private, signed-URL delivery like IDs). Visibility chosen at upload and server-enforced, never client-overridable.
- [ ] 0.5 MB is **stored size**: accept up to ~10 MB from camera → client downscale/compress to ≤0.5 MB → user approves readable preview → upload → server verifies actual bytes + mime (jpeg/png/webp only, no PDF for profiles) + EXIF strip.
- [ ] Legibility/preview tests required before approval (feeds from Task 9). Quick math for the report: 1 GB ÷ 0.5 MB ≈ 2,000 profiles shared with everything else — the limit slows growth, it does not solve it.
- [ ] Specs: oversized-input compresses to ≤0.5 MB; undisplayable input rejected without blocking valid onboarding; public/private isolation (private profile unreachable without signed URL).

---

## What does NOT help (do not implement these)

- Deleting superseded identity documents or receipts to reclaim quota — history/financial; approval-gated only.
- Moving file bytes into Postgres (base64) — shifts the problem to the Phase 2 meter.
- Making private buckets public to "save" anything — zero storage saving, security downgrade.
- Direct Dashboard object deletion without DB reconciliation — creates dangling rows.
- Silently blocking onboarding uploads at a 0.5 MB input cap — breaks phones, breeds retry-duplicates.
- Second project/bucket as a quota workaround.
- Adding thumbnail/preview sidecar objects without approval — doubles stored bytes per file.

## Priority order (execute in this sequence)

1. **Task 1** — measure (closes the unverified-meter gap, records GB-Hrs + cycle dates).
2. **Task 2** — limits audit; propose the `service-images` cap.
3. **Tasks 3–5** — pre-checks, grant discipline, hash dedupe (fastest real savings).
4. **Task 7** — reconciliation dry run (report only).
5. **Tasks 10–11** — public URL media (lets large public video leave the Storage meter entirely).
6. **Task 6** — CMS video policy on top of the URL outlet.
7. **Task 8** — retention policy → approval → dry run → execution.
8. **Tasks 9 + 12** — compression approval then profile pipeline.
9. **Task 13** — removal-path audit alongside.
10. **Task 14** — archival tiering, only with measures and approval.

## Verification (run all, in this order)

```sh
corepack pnpm exec turbo run test --force --concurrency=2 -- --maxWorkers=2
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm check:env
git diff --check
```

- New/changed specs: `corepack pnpm --filter api exec vitest run <path> --maxWorkers=2` (same per workspace).
- If any SQL changed: `pnpm test:db:local` and `pnpm test:db:harness`, plus `supabase/security/rls_invariants.sql` (empty = PASS).
- Storage claims require measured bytes: per-bucket totals before → after using the same SQL both times; URL-media claims require bytes-avoided per fixture (bucket bytes that would have been stored).
- Auth-setting, bucket-policy or rate-limit changes additionally require controlled Preview validation with dated evidence — never against production Storage.
- Report raw results. Never present estimates as measurements.

## Deliverable format for the AI

For each task: files changed, migration names (if any), measured bytes before → after (or bytes-avoided for URL media), tests added, and any deviation from this plan with the reason. Mark each checklist item checked or explain why it was skipped. Mark unverified items as unverified — never present estimates as measurements.

## Out of scope for this phase

- No deletions without written approval (Task 8 gate).
- No egress work (Phase 1, `docs/supabase/solutions/EGRESS-SOLUTIONS.md`); no database-size work (Phase 2, `docs/supabase/solutions/DATABASE-SOLUTIONS.md`); no MAU work (Phase 3, `docs/supabase/solutions/MAU-SOLUTIONS.md`).
- No quota monitor, no new monitoring service, no custom auth, no MongoDB work, no database abstraction layer.
- No deploy, no production Storage/bucket change, no Auth change without explicit approval.
- No weakening of RLS, bucket policies, column grants, onboarding-token semantics or money rules.

## Operator monitoring (manual, monthly)

1. Check the Supabase Dashboard org usage page → Storage size (GB-Hrs, all projects then per-project filter). Dashboard is authoritative.
2. Remember: Storage is **org-wide** and billed as a **cycle average (GB-Hrs)** — unlike database size (per-project snapshot) and egress/MAU/logs (per-cycle counters). Note the cycle dates; early cleanup moves the average, late cleanup may not clear a restriction until next cycle.
3. Advisory levels: **70%** investigate growth, **85%** obtain a capacity decision, **95%** urgent.
4. Refresh per-bucket totals and the >5 MB listing with the read-only SQL in this file, without reading object contents.
5. When the meter approaches its budget: first dedupe + compress + move public video to URLs (Tasks 5, 9–11), then review retention/archival options or obtain company approval for more capacity. Never silently block uploads or create a workaround project.
