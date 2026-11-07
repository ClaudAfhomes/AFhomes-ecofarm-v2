# Public website CMS completion design

Date: 2026-10-24
Branch: claud/clean-develop
Status: Proposed for user approval. No production implementation authorized by this document alone.

## Intent and approved approach

Make the existing AFhomes public website manageable by authorized staff without editing JSON or source code. Preserve the current public layout, components, styling, and responsive behavior.

The user selected normal content forms within the existing design. Alternatives considered were configurable supported sections and an unrestricted layout builder. Those introduce layout editing the user did not select. Existing custom pages remain supported with guided editing for their supported blocks; this is not a redesign or arbitrary layout builder.

## Current repository evidence

- Admin CMS provides document JSON editors, a custom page JSON section editor, media uploads, and read-only history.
- Documents are site, pageContent, experiences, vip, faq, stories, and mediaBlocks. FAQ, VIP website content, and media placement lack dedicated editor navigation.
- The public site overlays published documents on static defaults. Shape mismatch currently falls back silently. Several editor labels and SEO navigation do not clearly match the document being edited.
- Draft and published snapshots are separate. Existing update versions, CMS permissions, audit records, and private business surfaces must be preserved.
- Custom-page contracts advertise more block types than the renderer fully implements. Only supported controls may be offered; every existing supported block needs a matching renderer.

## Editor experience

Provide clear CMS navigation for Website Pages, Experiences, Stories, FAQ, VIP Website Content, Media, Site Settings, SEO, and History. Reuse current shared form components and styles.

Website Pages exposes existing named pages and their content sections with readable labels, text and multiline fields, list controls, links, images, and relevant enums/booleans. Preserve the existing order/layout of the built-in pages. Repeated content such as FAQs, stories, highlights, gallery images, and navigation items can be added, edited, reordered, and archived where the existing model supports it. Technical IDs and established route keys are stable and are not normal text inputs.

Site Settings covers logo, brand, contact channels, public addresses/maps, social links, navigation, and footer. SEO covers actual global and page metadata. Legal/privacy/contractual copy is clearly identified, preserved on initialization, and only changed through an explicit staff edit; it is never regenerated or normalized automatically.

VIP Website Content edits marketing copy and imagery only. Catalog prices, benefits entitlements, points rules, sale snapshots, commissions, payment/activation workflows, staff/customer identity verification, and Public Verification Settings remain owned by their existing operational modules.

Use existing media assets through a picker with thumbnail, name, type, and alt text. Retain supported safe external URLs and existing upload limits. No private documents or payment receipts are offered as public media. Image/video placement uses existing site slots rather than creating arbitrary layouts. No dependency installation is proposed.

## Content model and initial drafts

Create canonical shared contracts for the existing public content shapes, including optional fields and empty lists. Move public defaults to a neutral shared content location accessible to Admin and Web without importing Web code into Admin or server code. Preserve values and public output during that move.

Missing documents start from the complete current website defaults in the editor, not an empty JSON object. Opening a screen never writes or publishes. Existing valid drafts are preserved. Invalid legacy drafts receive actionable field errors and a recovery path that preserves original content rather than silently overwriting it.

Existing fixed public page paths stay fixed. Story/experience slug edits must be validated against supported routes and collisions; do not offer creation of a route that the public app cannot render. Existing custom page slug restrictions remain server-enforced.

## Save, preview, publish, and history

Save Draft validates data and persists an unpublished draft with change summary and optimistic concurrency. Show saved/error/conflict states and protect unsaved edits during navigation. Publication is explicit; never publish unsaved input implicitly.

Preview renders the draft using the real public components with a visible preview indicator. Preview data is available only to authorized staff and must never enter the anonymous CMS endpoint or a shared public cache. Use a scoped authenticated preview read and a short-lived in-memory preview session; never place draft content, access tokens, or credentials in URLs or persistent public storage. The implementation may choose a same-origin bridge between the existing Admin and public app shells if required by their separate localhost ports; validate sender origin, source window, and session correlation.

Publish validates the exact saved version being published. Reject a stale version instead of publishing another editor's changes. Draft saves do not alter the published snapshot. Unpublish restores the established fallback behavior, with a clear explanation in the editor.

History supports reading prior versions and restoring one as a new draft, never rewriting or deleting prior versions. Restore requires the existing edit permission and current version check. Publishing a restored draft is a separate action. Preserve append-only audit history.

## Server, public rendering, and security

Keep existing CMS permission modules and per-request staff authorization. Validate content schemas and safe URLs server-side on writes and publication, with consistent client validation. Deny unauthorized draft reads, changes, preview, restore, and publication. Public endpoints return published data only.

Remove silent whole-document rejection of valid optional/list values by using the shared schema. Keep safe defaults for unavailable public CMS; do not leak draft content as fallback. Ensure all public consumers react to hydration and each editable field feeds its actual rendered location. Preserve public URL sanitizers and render text without raw HTML injection. SEO metadata must update on navigation and publication hydration.

Reuse current tables, bucket, snapshot, and version history mechanisms. Add a forward migration only if an atomic change cannot be implemented correctly with the current schema/RPCs; document it and prove it against disposable local PostgreSQL. Do not apply shared migrations or publish live content without separate approval.

## Verification and completion criteria

1. Every selected public content group has a working form initialized from real current defaults or stored drafts, without mandatory JSON editing.
2. Draft edits survive reload and remain absent from public reads until publication.
3. Authenticated preview matches the saved draft; anonymous users cannot fetch it.
4. Publish/reload updates the intended public component, image/link, and SEO metadata; unpublish behavior is clear.
5. Conflicting saves/publishes/restores fail without losing another editor's work.
6. Media selection, invalid URLs, optional/empty lists, broken upload handling, and permissions have meaningful contract/API/UI tests.
7. Restore creates a new draft/version and preserves history and public output until explicit publication.
8. Authenticated local browser E2E demonstrates edit/save/reload/preview/publish/restore on disposable local data, plus mobile editor and unchanged public design checks.
9. Run targeted checks, then relevant complete contracts/API/UI/typecheck/lint/build suites; run local DB tests if SQL changes.

## Boundaries and builder decisions

Implementation may split the work into coherent internal stages but must complete the full selected scope before claiming completion. Reuse current TanStack Query, contracts, API client, shared UI, and existing permission infrastructure. Exact field grouping and labels are builder decisions, informed by the existing public sections. No optional services, telemetry, additional roles, or general-purpose layout engine.

Unrelated local artifacts remain untouched. This design authorizes no shared DB writes, live content edits, migrations, commits, pushes, or deployment. Those require separate user authorization after reviewable implementation and verification.
