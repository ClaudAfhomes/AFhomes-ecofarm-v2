# CMS theme colours + editor usability (short design)

Date: 2026-11-22. Approved by the owner ("approve all").

## Intent
Make the public website's look editable from the CMS (colours) and make the CMS
faster to use: fewer clicks, still accurate, professional UI. Scope: public
website only (portals/admin untouched).

## Goals
- Site-wide theme: 4 brand colours (primary green, accent gold, background,
  text) with pickers + hex input, preset palettes, reset to AF Homes default,
  live mini-preview. All shades derived from the 4 inputs.
- Contrast check (WCAG AA 4.5:1 for text/background pairs) blocks publish.
- Editor: sticky section navigator, field search, auto-filled change summary
  (editable), one "Save & publish" with confirmation (Save draft kept), sticky
  unsaved-changes bar, real colour/image/toggle inputs.

## Non-goals / anti-goals
- No font picker (needs web-font loading; later).
- Per-section locked colour tags stay locked (theme recolours them).
- No DB migration, no new permission, no change to draft/publish/history rules.
- Anti-goal: a theme that half-recolours the site or makes text unreadable.
- Anti-goal: an unpublished draft affecting the live site.

## Approaches considered
1. **4 brand colours, shades derived (picked).** Coherent, simple, fully
   recolours the site.
2. Every shade editable (~70 values): hard to use, inconsistent results.
3. Presets only: not "fully editable".

## Decided design
- Storage: optional `theme` object in Site Settings (`SiteConfigSchema`),
  hex-validated in `packages/contracts`. Uses existing draft/publish/history/
  restore; editable only with `cms.settings`. No theme published = site
  unchanged.
- Public site: on CMS hydrate, the published theme overrides the `.afh-public`
  palette CSS variables (derived shades via `color-mix`). The draft preview
  applies the draft theme.
- Admin: "Theme & colours" section in Site Settings with pickers, presets,
  reset, mini-preview, contrast status.
- Editor usability changes apply to every CMS document page.

## Left to the builder
Exact shade derivation ratios, preset palette values, diff-to-summary wording,
navigator layout.
