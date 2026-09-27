# AF Homes Phase 6 CMS

## Scope and safety

Phase 6 reconstructs the source-controlled parts of the deleted legacy CMS inside the current AF Homes platform. It does not alter the Phase 4 redemption migration or the Phase 5 reconciliation migration. The legacy Supabase project is not a dependency and its credentials, URLs, `admin_users` table, `is_admin()` function, and standalone admin login are not reused.

No remote migration, seed, deployment, invitation, or push is part of this phase implementation.

## Legacy inventory

The `claud` branch of `ClaudAfhomes/Claud-AF-home-branch` contained two overlapping CMS models:

- `cms_documents`: seven validated JSON documents (`site`, `pageContent`, `experiences`, `vip`, `faq`, `stories`, and `mediaBlocks`) with optimistic saves and `cms_history`.
- A visual builder: `cms_pages`, `cms_page_sections`, separate published page/section snapshots, `cms_page_versions`, `cms_media_assets`, `cms_navigation_items`, and `cms_site_settings`.
- Page blocks: `hero`, `rich-text`, `image`, `gallery`, `video`, `two-column`, `features`, `services`, `testimonials`, `faq`, `cta`, `contact`, `map`, and `divider`.
- SEO fields on pages and page versions, including Open Graph title, description, and image.
- A public `cms-media` bucket with authenticated admin upload/delete and public reads.
- A standalone `admin_users` authorization system and direct browser mutations.
- Inquiry tables, a persistent fingerprint rate limit, an Edge Function, outbound email, an inbox, archive state, and a purge function with a configurable retention period.

The source also contains repository-held defaults and images. Database-only edits, uploaded Storage objects, inquiry rows, version rows, and activity rows from the deleted project cannot be recovered without a backup.

## Current-system comparison and collisions

The current AF Homes database had no CMS-named tables or bucket, so the Phase 6 object names do not collide. The important semantic collisions were architectural:

- Legacy `admin_users` conflicts with the current `staff_users -> role assignments -> role permissions - restrictions` model. It is not ported.
- Legacy browser writes conflict with the AF Homes invariant that browsers are read-only. All Phase 6 mutations go through the server API.
- Legacy history was a second operational audit stream. Phase 6 keeps immutable content versions for content reconstruction and also writes important actions to the existing `audit_events` table.
- Legacy media bucket name was generic. Phase 6 uses `afhomes-cms-media` and does not alter the three existing private buckets.
- Legacy inquiry email recipients, production origins, notification provider configuration, and retention behavior are deployment/business decisions. The inquiry backend remains deferred and the Phase 3 offline contact fallback remains unchanged.

## Database and permissions

Migration `20261001000001_afhomes_phase6_cms_foundation.sql` adds:

- `cms_documents` and `cms_document_versions`
- `cms_pages`, `cms_page_sections`, and `cms_page_versions`
- `cms_media_assets`
- the `afhomes-cms-media` public-delivery bucket
- `cms.pages`, `cms.media`, `cms.settings`, and `cms.history`

No existing non-Super-Admin role receives a CMS permission. Super Admin receives all active modules through the existing implicit rule. Other staff must receive explicit role rows. Browser roles have SELECT-only table grants gated by RLS and no CMS table write grants. Storage object writes are performed only with the server service role; the public bucket policy is SELECT-only.

Documents keep separate draft and published JSON. Pages keep editable rows/sections plus an immutable published snapshot, so editing a draft cannot change the public page before the next publish. Optimistic versions reject stale saves. Important mutations append `audit_events`, while document/page version tables preserve content history.

## API and UI

The literal router import `../_handlers/cms.js` owns `/api/v1/cms/**` and is covered by the route-artifact test.

Public:

- `GET /cms/public`
- `GET /cms/public/pages/:slug`

Staff:

- `GET /cms/documents`
- `PATCH /cms/documents/:key`
- `POST /cms/documents/:key/publish|unpublish`
- `GET|POST /cms/pages`
- `PATCH /cms/pages/:id`
- `POST /cms/pages/:id/publish|unpublish`
- `GET|POST /cms/media`
- `DELETE /cms/media/:id`
- `GET /cms/history`

Admin routes live under `/admin/cms` inside the existing shell: pages, media, stories, experiences, site settings, SEO, and history. Stories and experiences use the existing public templates rather than new layouts.

The public repository renders Phase 3 defaults immediately and hydrates published documents in the background. A failed or malformed CMS request leaves the static defaults in place. A one-segment `/:slug` route serves published custom pages after every known static route, and reserved platform prefixes are refused.

## Media rules

Uploads accept JPEG, PNG, WebP, GIF, and MP4 up to 10 MiB. Both the declared MIME type and file signature are checked. Object names are generated UUID paths under the acting staff UUID; browser filenames cannot choose a bucket path. Metadata and upload must both succeed. Deletion is refused while a public URL appears in any CMS document or page section, and successful uploads/deletes are audited.

## Seeding and recovery

No migration publishes placeholder content. This is deliberate: publishing empty or guessed JSON would override the working Phase 3 defaults. The safe reconciliation process is:

1. Use the repository-held Phase 3 defaults as the public source of truth.
2. Create a CMS draft for one document at a time through the authorized admin API.
3. Review the draft in the unchanged public template.
4. Publish explicitly.
5. Re-running migration/seed preparation never updates an existing CMS row or overwrites an admin edit.

All repository images and static defaults are recoverable. Deleted-project edits, Storage uploads, inquiry rows, history rows, and admin activity are unrecoverable unless an external backup is supplied.

## Deferred inquiry backend

The source is sufficient to describe the old flow but not to choose current retention, email recipient/provider, approved production origins, or whether reservations belong in the contact channel. Those are consequential business/security rules. Phase 6 therefore leaves the tested offline outbox/mail fallback intact instead of silently recreating the old operational policy.
