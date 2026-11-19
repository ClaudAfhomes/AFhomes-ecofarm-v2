# Public Website CMS Completion Implementation Plan

**Goal:** Complete form-based management of the existing public website without redesign or operational changes.
**Architecture:** Shared content schemas and neutral presentation defaults; existing CMS tables/API/permissions; guided Admin forms; saved-draft preview in the real Web renderer.
**Tech Stack:** Existing React/Vite, Zod, TanStack Query, Supabase, shared UI.
**Spec:** ../specs/2026-10-24-public-website-cms-design.md, reconciled with the user implementation attachment dated 2026-10-24.

## Constraints

Local implementation/verification only on claud/clean-develop. No commits, pushes, merges, deployments, shared SQL, or live publication. Preserve layout/style/animations, legal copy, operational ownership, drafts/history and unrelated artifacts. No new dependencies. A prepared migration, if necessary for atomic writes, remains local only.

## Implementation map

- contracts: schemas/cms.ts + cms-content.ts: canonical presentation schemas, URL validation, exact version mutations, preview/history contracts.
- shared UI website-content subpath: current defaults/assets with original Web imports preserved through reexports, so Admin never imports the Web app.
- api/_handlers/cms.ts: authorized draft/preview/history, schema validation, stale publication rejection, reference-safe media.
- Admin cms/: normal content/list/media forms, website pages, dedicated groups, SEO/site ownership split, saved preview and restore; app navigation/route guards retain current module keys.
- Web marketing/lib/cms.ts, preview bridge, SEO, CmsPage: validate and hydrate published content, render saved preview with no public draft endpoint/cache, correct actual consumers without changing layouts.
- existing tests + focused new contracts/API/UI tests: invalid/empty/optional content, initialization/preservation, save/public isolation, exact version conflicts, preview confidentiality, restore, media/SEO.

## Tasks

- [ ] 1. Add canonical content schemas and shared unchanged defaults; test valid current content and malicious URLs.
- [ ] 2. Implement authorized exact-version CMS mutation/history/preview paths; test denial, conflict, restoration and public isolation. Prepare smallest atomic migration only if needed; test locally.
- [ ] 3. Replace JSON editors with guided forms for all selected groups, media selection and supported custom blocks; test initialization/no automatic writes and UI workflows.
- [ ] 4. Connect real saved-draft preview and all public consumers/SEO, preserving visual output; test bridge origin/source/session and draft isolation.
- [ ] 5. Run relevant suites/typecheck/lint/build; local authenticated disposable E2E and desktop/mobile comparisons; write exact implementation report and remaining blockers. Stop before external writes.

## Review focus

- Never replace an invalid legacy draft with defaults silently; preserve it and show field errors.
- Empty lists/optional fields must not cause the whole public document to disappear.
- Shared assets must keep working after moving defaults; no public design changes.
- Concurrent writes/publication/restoration must reject stale versions and preserve history.
- Public preview and CMS media must never disclose private business data or access tokens.

Baseline evidence: outputs/cms-completion/before-desktop.png and before-mobile.png. Existing dirty files are unrelated generated import results and Supabase CLI marker plus untracked prior reports/evidence.
