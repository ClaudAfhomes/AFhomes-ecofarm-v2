# CMS Theme Colours + Editor Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let CMS editors recolour the public website safely with a few brand colours, and make every CMS document page faster to edit.

**Architecture:** An optional `theme` object in the `site` CMS document holds 5 hex colours. One shared pure module in `@afhomes/contracts` derives the full palette and checks contrast, and every layer uses it: the API rejects bad themes, the admin shows previews, and the web app sets CSS variables. The public site applies a theme only once it is published, or inside the private draft preview. The editor gets a section navigator, field search, an auto-filled summary, Save & publish, and a sticky action bar.

**Tech Stack:** Zod 4, React 19, TanStack Query, CSS Modules (admin), Tailwind v4 `@theme` vars (web), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-22-cms-theme-usability-design.md`

## Global Constraints
- Public website only; staff and customer portals look unchanged.
- No DB migration, no new permission. The theme is edited under `cms.settings` (Site Settings) only.
- No published theme means the site renders exactly as it does today, with no inline variables.
- Contrast is WCAG AA, 4.5:1, for every checked pair. A failing theme cannot be saved by the API or published from the admin.
- No font picker. The per-experience accent colours (coral, cyan, magenta, pink) stay locked.
- Never commit, push or deploy without an explicit ask. Re-read a file before editing it and use Edit. Never revert others' changes (the marketing files carry another session's edits).
- Prettier: `semi`, `singleQuote`, `printWidth: 100`, `trailingComma: all`.

**My call (deviation from the spec's "4 colours"):** the theme has **5** colours: primary, accent, background, text and **dark sections**. Navy is the site's second most used palette (142 utility uses, for dark sections and the footer). Without it, a recolour would leave a large part of the site navy.

## Review Focus
1. Shorthand or uppercase hex (`#ABC`, `#57AB4B`): accept it and normalise to lowercase 6-digit, so the colour picker and the text input agree.
2. "Reset to AF Homes default" removes `theme` entirely rather than writing default values, so the site is byte-identical to today (test in Task 4).
3. A hostile or malformed published `theme` reaching the web app (a string, missing keys, `red; background:url(x)`): ignore it and leave no inline style (test in Task 3).
4. A preview message from a wrong origin or session must not change the page (test in Task 3).
5. Save & publish when the publish step fails after the save succeeded: show "Draft saved, but publishing failed: …" and keep the version current (test in Task 5).

---

### Task 1: Shared theme module (contracts)

**Files:**
- Create: `packages/contracts/src/schemas/cms-theme.ts`
- Create: `packages/contracts/src/schemas/cms-theme.spec.ts`
- Modify: `packages/contracts/src/schemas/cms-content.ts`. Add `theme: SiteThemeSchema.optional(),` to `SiteConfigSchema`.
- Modify: `packages/contracts/src/index.ts`. Add `export * from './schemas/cms-theme.js';`.

**Interfaces (Produces):**
- `hexColorSchema`: a Zod string. It accepts `#rgb` and `#rrggbb` in any case and transforms the value to lowercase `#rrggbb`.
- `SiteThemeSchema`: `z.object({primary, accent, background, text, dark})` of `hexColorSchema`, `.strict()`, with a `superRefine` that adds one issue per failing pair from `themeContrastIssues`.
- `type SiteTheme = z.infer<typeof SiteThemeSchema>`.
- `mixHex(a: string, b: string, weightA: number): string`: per-channel `round(a*w + b*(1-w))`, returning lowercase hex.
- `contrastRatio(a: string, b: string): number`: WCAG relative luminance.
- `deriveThemePalette(t: SiteTheme): Record<string, string>`: keys are CSS variable names, values are hex. White is `#ffffff` and black is `#000000`. The weights are below.
  - `leaf-500` is the primary colour.
    - `leaf-400/300/200/100` = `mixHex(primary, white, .85/.4/.2/.1)`.
    - `leaf-600/700` = `mixHex(primary, black, .82/.68)`.
    - `pine-600/700/800/900/950` = `mixHex(primary, black, .55/.45/.36/.28/.2)`.
  - Sage:
    - `sage-100/200/300/400/500` = `mixHex(primary, background, .06/.12/.16/.3/.5)`.
    - `sage-600/700` = `mixHex(primary, text, .35/.25)`.
  - `gold-500` is the accent colour.
    - `gold-100/300/400` = `mixHex(accent, white, .25/.7/.85)`.
    - `gold-600` = `mixHex(accent, black, .88)`.
  - `cream-50` is the background colour.
    - `cream-100/200/300/400` = `mixHex(text, background, .02/.07/.12/.18)`.
  - `ink-800` is the text colour.
    - `ink-900` = `mixHex(text, black, .75)`.
    - `ink-700/600/500/400` = `mixHex(text, background, .9/.78/.66/.5)`.
  - `navy-900` is the dark colour.
    - `navy-950` = `mixHex(dark, black, .75)`.
    - `navy-800/700/600/500/400/300/200/100` = `mixHex(dark, white, .88/.78/.66/.52/.38/.25/.14/.06)`.
  - Keys are written `--color-<name>`, for example `--color-leaf-500`.
- `themeContrastIssues(t): {pair: string; ratio: number}[]` checks these pairs, each against 4.5:
  - `text on background`;
  - `muted text on background` (ink-500 vs background);
  - `background on dark sections` (background vs dark);
  - `background on primary buttons` (background vs pine-800);
  - `text on accent` (text vs accent).
- `DEFAULT_SITE_THEME: SiteTheme = {primary:'#57ab4b', accent:'#fbc75e', background:'#fcfbf8', text:'#242b26', dark:'#1f2b52'}`.
- `SITE_THEME_PRESETS: {name: string; theme: SiteTheme}[]`: AF Homes default plus 3 more (Forest, Coastal, Earth). The builder picks the values; every preset must pass the contrast check.

- [ ] **Step 1: Write failing tests** in `cms-theme.spec.ts`:
  - `normalises #ABC to #aabbcc`
  - `rejects 'red' and '#12345g'`
  - `contrastRatio('#000000','#ffffff')` ≈ 21 (toBeCloseTo 1 decimal)
  - `mixHex('#000000','#ffffff',0.5) === '#808080'`
  - `deriveThemePalette(DEFAULT_SITE_THEME)['--color-leaf-500'] === '#57ab4b'`, and the result has 45 keys
  - `every preset passes SiteThemeSchema`
  - `a theme with text '#eeeeee' on background '#ffffff' fails with a "text on background" issue`
  - `SiteConfigSchema` accepts the website default with no theme, and also with `DEFAULT_SITE_THEME`
- [ ] **Step 2:** Run `cd packages/contracts && npx vitest run src/schemas/cms-theme.spec.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement the module and wire it into `SiteConfigSchema` and the index.
- [ ] **Step 4:** Run the same spec plus `src/schemas/cms-content.spec.ts`. Expected: PASS. Run `npx tsc --noEmit -p .`: 0 errors.

### Task 2: API rejects invalid themes

**Files:**
- Modify: `api/_handlers/cms.ts` (the PATCH `documents/:key` branch, near line 180)
- Test: `api/_handlers/cms.spec.ts`

**Interfaces:** Consumes `SiteThemeSchema`.

- [ ] **Step 1:** Write two failing tests in `cms.spec.ts`. Follow the existing PATCH test setup.
  - `PATCH site with theme {text:'#eeeeee', background:'#ffffff', …}` returns 400 `VALIDATION_ERROR` with the message `Theme colours are invalid or too low in contrast.`
  - `PATCH site with DEFAULT_SITE_THEME` returns 200.
- [ ] **Step 2:** Run `pnpm --filter api exec vitest run _handlers/cms.spec.ts`. Expected: the first test FAILS (it returns 200).
- [ ] **Step 3:** Change the code. After `parsed.success`, if `key.data === 'site'` and `parsed.data.value` is an object with a `theme` key that is not undefined, run `SiteThemeSchema.safeParse(theme)`. On failure, return the 400 above. Validate before `authorizeAfHomes`, matching the existing order.
- [ ] **Step 4:** Rerun the spec plus `phase28-cms.spec.ts`. Expected: PASS.

### Task 3: Public site applies the theme and serves the draft preview

**Files:**
- Create: `apps/web/src/marketing/lib/theme.ts`, which exports `themeStyle(theme: unknown): React.CSSProperties | undefined`. It returns `undefined` unless `SiteThemeSchema.safeParse` succeeds; otherwise it returns `deriveThemePalette`.
- Create: `apps/web/src/marketing/lib/cms-preview.ts`, which exports `startCmsPreview(adminOrigin: string): () => void`.
- Modify: `apps/web/src/marketing/lib/cms.ts`. Add `export function applyCmsPreview(key: CmsDocumentKey, value: unknown): void`. It overlays one document with `safeOverride` against its fallback and dispatches `afhomes-cms-updated`. While preview mode is set, a later `hydrateCms()` must not overwrite it: track this with a `previewKeys` Set and skip those keys.
- Modify: `apps/web/src/marketing/MarketingLayout.tsx`. Use the existing `useCmsRevision` hook. Set `style={themeStyle(cmsRepository.getSiteConfig().theme)}` on the `.afh-public` div. Call `startCmsPreview(new URL(env.VITE_ADMIN_URL).origin)` in an effect only when `?cmsPreview=` is present and `window.parent !== window`.
- Modify: `apps/web/src/marketing/types/site.ts`. Add `theme?: unknown` to `SiteConfig`.
- Test: `apps/web/src/marketing/lib/theme.spec.ts` and `apps/web/src/marketing/lib/cms-preview.spec.ts`

**Preview protocol** (it must match `apps/admin/src/features/cms/CmsPreview.tsx`):
1. The web page posts `{type:'afhomes-cms-preview-ready', session}` to `window.parent` with `targetOrigin = adminOrigin`.
2. It accepts `message` events only if all of these hold:
   - `event.origin === adminOrigin`;
   - `event.source === window.parent`;
   - `data.type === 'afhomes-cms-preview-content'`;
   - `data.session === session`.
3. It then calls `applyCmsPreview(data.document.key, data.document.draftValue)`. `data.page` (custom pages) is ignored for now; this is listed under Remaining.

- [ ] **Step 1:** Write failing tests.
  - `themeStyle(undefined)` and `themeStyle('x')` return `undefined`.
  - `themeStyle({...DEFAULT_SITE_THEME, primary:'red; background:url(x)'})` returns `undefined`.
  - `themeStyle(DEFAULT_SITE_THEME)['--color-leaf-500'] === '#57ab4b'`.
  - Preview: it posts ready to the parent with the admin origin.
  - Preview: a content message from the wrong origin, or with the wrong session, leaves `cmsRepository.getSiteConfig().theme` undefined.
  - Preview: the correct message sets it and fires `afhomes-cms-updated`.
- [ ] **Step 2:** Run `cd apps/web && npx vitest run src/marketing/lib`. Expected: FAIL.
- [ ] **Step 3:** Implement the three files and edit the two existing ones.
- [ ] **Step 4:** Run `npx vitest run src/marketing` and `npx tsc --noEmit -p .`. Expected: PASS and 0 errors. The existing `marketing.spec.tsx` still passes.

### Task 4: Theme & colours editor (admin)

**Files:**
- Create: `apps/admin/src/features/cms/ThemeEditor.tsx` and `ThemeEditor.module.css`
- Create: `apps/admin/src/features/cms/ThemeEditor.spec.tsx`
- Modify: `apps/admin/src/features/cms/CmsDocumentPage.tsx`. In `mode==='site'`, exclude `theme` from the generic field list and render `<ThemeEditor value={obj.theme} onChange={t => setValue({...obj, theme: t})} disabled={…}/>` above `ContentFields`. The `onChange(undefined)` path deletes the key.

**Interfaces:** `ThemeEditor({value, onChange, disabled}: {value: unknown; onChange: (t: SiteTheme | undefined) => void; disabled: boolean})`.

**UI**, in a `fieldset` with the legend "Theme & colours":
- 5 rows. Each row has a native `<input type="color">` and a hex `TextField`, both labelled with the colour name (Primary, Accent, Background, Text, Dark sections).
- When `value` is undefined, the inputs show `DEFAULT_SITE_THEME` with the note "Using the AF Homes default colours." Editing any input creates a theme.
- Preset buttons, one per preset (`aria-pressed` when it matches the current theme).
- A "Reset to AF Homes default" button calls `onChange(undefined)`.
- A mini-preview card styled with `deriveThemePalette` as inline CSS variables: a hero strip (dark), a heading and body text, a primary button and an accent badge.
- A contrast list: each pair shows its ratio, a pass/fail icon and text (`role="status"`). When a pair fails: "Fix the colours marked below before saving."

- [ ] **Step 1:** Write failing tests.
  - Typing `#ABC` into "Primary" calls `onChange` with `primary:'#aabbcc'`.
  - Clicking the "Forest" preset calls `onChange` with that theme.
  - "Reset to AF Homes default" calls `onChange(undefined)`.
  - A failing theme shows "Text on background" with the fail text.
  - In `cms.spec.tsx`: the site settings page renders "Theme & colours", and the Save button is disabled while the theme fails contrast (the document schema rejects it).
- [ ] **Step 2:** Run `cd apps/admin && npx vitest run src/features/cms`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use `@afhomes/ui` `TextField`, `Button` and `Icon`, and tokens only.
- [ ] **Step 4:** Rerun the spec, then `npx tsc --noEmit -p .` and `pnpm exec eslint src/features/cms`. Expected: all pass.

### Task 5: Faster editing on every CMS document page

**Files:**
- Modify: `apps/admin/src/features/cms/content-model.ts`. Add `summarizeChanges(before: unknown, after: unknown): string`.
- Modify: `apps/admin/src/features/cms/CmsDocumentPage.tsx`
- Modify: `apps/admin/src/features/cms/ContentFields.tsx`. Each fieldset gets `id={cmsFieldId(path)}`, where `cmsFieldId(path: string) => 'cms-' + path.replace(/\./g, '-')` is exported from `content-model.ts`. Booleans render as a switch (CSS on the existing checkbox, `role="switch"`).
- Create: `apps/admin/src/features/cms/CmsSectionNav.tsx` (+ CSS in `cms.module.css`)
- Test: `content-model.spec.ts`, `cms.spec.tsx`

**Behaviour:**
- `summarizeChanges`: compares top-level keys, and one level deeper for objects. It returns `Updated <Label>, <Label> and N more` (at most 3 labels, using `fieldLabel`), or `''` if nothing changed. Example: changing `footerTitle` and `theme.primary` gives `Updated Footer Title, Theme`.
- Summary field: it shows `summarizeChanges(savedValue, value)` until the user types in it (track a `summaryEdited` flag). Save needs `summary.trim().length >= 3`, which the auto-text satisfies as soon as anything changes. The label "Change summary" is kept and the "(Optional)" marker removed. The API still requires it, so the field is not optional.
- `CmsSectionNav({sections, query, onQuery})`:
  - `sections` are `{id, label, fieldLabels: string[]}[]`, built from the displayed schema's top-level keys (for arrays: the entry summaries).
  - It is sticky beside the form on wide screens (≥1024px) and a horizontal chip row above the form on narrow screens.
  - The "Find a field" search box filters sections whose label or `fieldLabels` include the query (case-insensitive).
  - Clicking a section calls `document.getElementById(id)?.scrollIntoView({block: 'start'})`, then focuses the section's first input.
- Sticky action bar (`position: sticky; bottom: 0`) holds:
  - status text: "Unsaved changes", "All changes saved" or "Published";
  - **Save draft**;
  - **Save & publish**, which opens a `ConfirmDialog` ("Publish to the public website?"). On confirm it saves, then publishes with the returned version. On a publish failure it shows `Draft saved, but publishing failed: <message>`;
  - **Publish saved draft** (only when not dirty, with unpublished changes);
  - **Preview saved draft**;
  - **Unpublish**.
  - Existing permission and validity disabling is kept.

- [ ] **Step 1:** Write failing tests.
  - `summarizeChanges` examples: no change gives `''`; one key; 5 keys gives `"and 2 more"`.
  - cms.spec: after an edit, Save is enabled with no typing, and the summary box holds `Updated …`.
  - cms.spec: Save & publish → confirm → both PATCH and publish are called in order.
  - cms.spec: a publish 409 after a successful save shows the "Draft saved, but publishing failed" alert.
  - cms.spec: "Find a field" with `footer` leaves only the matching sections in the nav.
  - Update the existing cms.spec lines that type into `Change summary(Optional)` to the new label `Change summary`. This changes the selector only; the assertions stay.
- [ ] **Step 2:** Run `cd apps/admin && npx vitest run src/features/cms`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun `src/features/cms`, plus `npx tsc --noEmit -p .` and eslint on the changed files. Expected: PASS.

### Task 6: Verification

- [ ] Run the full suites: `pnpm --filter api test`, and in each of admin, web and contracts run `npx vitest run` and `npx tsc --noEmit -p .`. Expected: all green. Report the counts.
- [ ] Browser check on the isolated stack `afhomes-engage-20261121` (`.tmp-bin/engage-browser`, ports 3110/5183/5184), never other stacks:
  1. Edit the theme, then Save & publish.
  2. The public home page shows the new colours. Reset brings back the original look.
  3. The draft preview iframe shows the draft theme.
  4. Mobile width shows no overflow.
  5. No console errors.
- [ ] Tear down the stack. Report Done / Changed / Verified / Remaining. No commit unless asked.
