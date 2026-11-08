> Historical handover: work continued after this note. Current local evidence
> and remaining limits are in [V4-VISUAL-COMPARISON.md](V4-VISUAL-COMPARISON.md).

# Claude handover: Customer Application V4

Date: 2026-11-07. Status: **IN PROGRESS — visual implementation not accepted.**

## Start here

Continue in `C:\Users\SSD-CLAUD\AFhomes-ecofarm-v2-supabase`, branch
`claud/supabase`. Verified HEAD:
`14b99d318f0e0b5150f801344ad2331e3f44412e`.

Read the actual project `AGENTS.md`, Git status and existing diff first. This is
a dirty shared checkout containing Claude's functional work and Codex's later
UI/document work. Preserve both. Do not reset, restore or broadly stage files.

The user wants the actual Customer Application to look and behave like this
exact HTML, not an approximation:

`C:\Users\SSD-CLAUD\AppData\Local\Temp\AFhomes_Customer_Application_V4.html`

Repository reference:
`docs/ui-reference/AFhomes_Customer_Application_V4.html`.

The user repeatedly rejected the previous visual implementation. Prior
completion notes describe earlier checks, not acceptance of the current UI.
Use the HTML's actual structure and CSS while retaining real application logic.
Keep both Customer Application and Reservation Agreement PDF downloads.

**Current authorization: local implementation and verification only. No database
writes/migrations, commits, pushes or deployment.** Supabase Postgres/Auth/private
Storage remain the backend. Do not adopt imported MongoDB operating instructions.
Do not bypass or weaken Turnstile.

## Preserve the functional changes

- Server-authoritative team matching: `api/_lib/team-match.ts` and its spec.
- AAO lookup and automatic recommender contacts; genealogy resolve handler/tests.
- One shared SM/SSM/SVD hierarchy and compact referrer verification.
- Sidebar auto-collapse, ID preview, civil-status tiles and free-text suffix.
- Existing seven steps, URLs/query parameters, draft state, validation, edit
  targets, submission and approval behavior.
- The removed `ApplicationNetworkSelection.tsx` and spec are pre-existing dirty
  deletions. Do not resurrect the duplicate network implementation.

Prefix remains pending separate authorization: no persisted Prefix column exists.
Do not add a non-persisting UI field. Exact proposed minimal DB/RPC/contracts
changes are documented in `CUSTOMER-APPLICATION-V4-COMPLETION.md` in this folder.

## Most recent partial edits — finish these first

The user requested this handover while the replacement was underway. These last
edits are not a finished visual implementation:

1. Added `apps/admin/src/features/business/CustomerApplicationV4.module.css` by
   copying the exact Temp HTML stylesheet, scoping selectors under `.application`
   and converting class selectors to camelCase. Prototype print/page CSS was
   omitted because the real document renderer already exists.
2. Started switching `official-forms-applications.tsx` to that module:
   new application root uses `application + wrap`; page heading, workspace,
   VIP aside, right column, frame, panel heading/body/footer use reference classes.
   The selected-card summary now uses the reference stat rows and a native
   expandable details element. New channel labels begin using reference chips.
   Actual state handlers and server calls remain connected.
3. Changed **compact workspace only** padding in
   `packages/ui/src/components/AppShell.module.css` to zero/max-width none, so
   the reference `.wrap` owns its exact padding and width.

**Important unfinished integration:** several newly referenced CSS hooks are
not yet declared (`vipTitle`, `planDisclosure`, `formFields`, `stepContent`,
`footerContents`). The copied file has the prototype's other class names.
Add the smallest necessary integration rules and matching markup. Do not pile
another approximate stylesheet onto the old override stack.

`ApplicationChoiceCards`, `ApplicationProgress`, holder fields, network fields
and Review still largely use the previous CSS/markup. New frame markup may
still duplicate section headings, margins or borders. The latest JSX/CSS must
be reviewed and tested before claiming success.

## Exact layout and remaining work

The HTML uses **normal page scrolling with a sticky left card**, not a
fixed-height nested right scroll container:

```css
.wrap { max-width:1430px; margin:0 auto; padding:32px 36px 50px }
.workspace { display:grid; grid-template-columns:268px minmax(0,1fr);
  gap:19px; align-items:start }
.vip { position:sticky; top:90px; padding:18px; border-radius:16px }
.right { min-width:0 }
```

The copied stylesheet contains the exact remaining declarations and responsive
breakpoints. Do not reintroduce `height:calc(100dvh - ...)`, max-height/overflow
scroll areas, or a sticky footer in the new application. Older versions remain
in `OfficialFormsPages.module.css`; the new root should cease inheriting the
old `editorSection[data-split]` overrides. Existing-record screens must retain
their working behavior.

Finish these reference structures:

- **VIP:** compact Bronze/Silver/Gold selector, persistent actual tier artwork,
  summary and expandable benefits; one selector only. Wire catalog values, never
  hardcode commercial values. Card artwork exports have transparent margins;
  size/crop within the preview to match the HTML. Keep loading/error/empty states.
- **Progress:** reference `progress/currentProgress/miniProgress/bar/stepnav`
  markup plus collapsible `stepmenu`. Preserve seven steps, reachable-step gate,
  focus return, URLs and existing navigation state.
- **Frame:** one `panelHead`, one `panelBody`, one `panelFoot`; remove duplicate
  step headings and inner panel borders. Reference headings/subtitles are in
  the HTML `render()` function. The initial substitute subtitles in the most
  recent partial edit still need to match its actual wording.
- **Payment:** reference tiles are **two columns**, not three. Existing
  `ApplicationChoiceCards` should use the exact tile/selected/icon styles.
- **Identity:** reference ID choices span the top (`tiles three`), followed by
  a separator and two columns: optional government ID number **left**, upload
  preview/actions **right**. Current app still has photo-left/choices-right.
  Preview is 164px high with `object-fit:contain`. Retain existing file/camera,
  cancel, preview-dialog, MIME validation and upload-on-save logic.
- **Holders:** reference mini header, Personal/Address/Contact/Additional tabs,
  two-column inputs, inline Sex choices, four civil-status tiles, compact
  Automatic/Manual RA number controls and optional Gold secondary holder.
  Preserve field values and keyboard tab behavior. Prefix is intentionally
  absent; free-text Suffix stays. Keep the actual PSGC/address implementation.
- **Network:** apply copied `networkInputGrid`, compact verification,
  `networkContact`, `sharedTeam`, three-column chain and `networkBottom` styles
  to Claude's existing functionality. Do not rebuild AA/team logic.
- **Channels:** finish selected checkbox chips; keyboard-accessible native
  controls remain. No invented defaults.
- **Certification:** reference compact boxes and evidence information; preserve
  consent/ID acknowledgment rules and honest verification status.
- **Review:** reference compact two-column summary boxes plus real Print
  Application, Download PDF and Download RA form actions. Current detailed
  review still differs visually. Preserve access to actual primary/secondary,
  network, channels/certification data and functional Edit targets.
- **Mobile:** match the HTML breakpoints, including stacked panels and compact
  left summary. Check overflow and focus at desktop and mobile widths.

Use React/native controls with real handlers. Do not embed the prototype's
demo JavaScript, fake success state, alerts or simulated persistence.

## Downloads already implemented — reuse

Under `apps/admin/src/features/business/`:

- `application-print.ts` + spec: actual-value A4 portrait paper rows, wrapping,
  font readiness, pagination, JPEG-backed PDF and isolated iframe printing.
- `reservation-print.ts` + spec: draft RA from actual holder/plan/payment inputs;
  saved RA from frozen server agreement values. All three tiers supported.
- `ApplicationReview.tsx` + `ApplicationReview.print.spec.tsx`: preview dialog,
  Print Application, Download PDF and Download RA form actions with error/loading
  handling. Printing/downloading must not submit or write business state.
- `official-forms-reservations.tsx`: saved Download RA PDF fetches the agreement
  again before rendering; existing server/XLSX/payment workflows remain intact.

The three supplied Bronze/Silver/Gold JPGs in Downloads are RA document
references. Use actual data; unknown payment receipts/dates/reservation numbers
and signature lines remain blank. No fabricated verification/signatures.
Current PDF pages are rasterized, not searchable/tagged accessible PDFs.

## Where to edit

- `official-forms-applications.tsx`: state/queries near the first half;
  `selectedPlan`/legacy `planPreview` around line 1350; new editor return around
  line 1560; step content/frame below that. Prefer symbol search over line numbers.
- `official-forms-fields.tsx`: `Field`, `SelectField`, `DateField`, `HolderFields`,
  AA input components and `RecommenderFields`. Preserve normalizers/contracts.
- `ApplicationChoiceCards.tsx` + CSS: shared radio choices.
- `ApplicationProgress.tsx` + CSS/spec: current progress implementation.
- `ApplicationReview.tsx` + CSS/specs: existing document handlers and review.
- `CustomerApplicationV4.module.css`: new copied source stylesheet.
- `packages/ui/src/components/AppShell.module.css`: compact layout integration.
  Earlier AppShell/Topbar/AdminLayout edits provide compact navigation and
  breadcrumbs; keep permission filtering and ordinary pages unchanged.

## Browser verification

An authenticated local Chrome session **was available through native computer
use**, even though the browser-host connector reported unavailable. Therefore
the older completion note saying no authenticated browser surface is stale.
Actual and reference first/Identity screens were viewed, revealing differences.
This does not establish seven-step or pixel-perfect acceptance.

- Local app: `http://localhost:5174/admin/customers/new?step=1`.
- Local dev services were running on admin 5174, web 5173, API 3000; recheck.
- Existing Chrome window was native window ID `132502`; inventory may change.
  Use supported native app control, fresh state and screenshots. Do not read
  browser credentials or bypass Turnstile. Do not submit/save test applications.
- A user-selected personal ID/photo may exist in an unsaved draft. Preserve it,
  avoid copying it into docs/evidence, and use a separate draft/tab for synthetic
  verification. User may also be operating Chrome; avoid conflicting actions.
- Before continuing computer use after context compaction, call
  `cua.rewriteDocumentation()` as required by the tool. Read the computer-use
  skill if starting in a fresh session.

## Verification status and commands

Earlier focused tests/builds passed **before the latest replacement**. They are
not proof of the current working tree. Previous counts included 98 form/holder/
blocker checks, 63 action/form checks (overlapping tests), and seven shared shell
checks. Do not sum overlapping counts or repeat those as current results.

Fresh handover check: `corepack pnpm --filter @afhomes/admin typecheck` passed
(exit 0) after the partial edits. This establishes TypeScript compilation only;
it does not prove that CSS hooks exist, layouts match, or workflows pass.

Run focused checks after finishing:

```powershell
corepack pnpm --filter @afhomes/admin typecheck
corepack pnpm --filter @afhomes/admin exec vitest run src/features/business/OfficialFormsPages.spec.tsx src/features/business/official-forms-fields.spec.tsx src/features/business/final-blockers.spec.tsx --maxWorkers=2
corepack pnpm --filter @afhomes/admin exec vitest run src/features/business/ApplicationProgress.spec.tsx src/features/business/ApplicationReview.spec.tsx src/features/business/ApplicationReview.print.spec.tsx src/features/business/application-print.spec.ts src/features/business/reservation-print.spec.ts --maxWorkers=2
corepack pnpm --filter @afhomes/ui typecheck
corepack pnpm --filter @afhomes/ui exec vitest run src/components/AppShell.spec.tsx --maxWorkers=1
corepack pnpm --filter @afhomes/admin build
```

Run affected-file ESLint using the admin config; shared UI does not have its own
eslint executable. Fix implementation regressions, preserve meaningful behavior
assertions. The old test expecting an inner right pane scroll contradicts the
exact HTML page-scroll behavior and needs updating. Plan heading/review text
assertions may also need deliberate updates. Do not weaken server/validation
tests to make UI checks pass. Do not run unrelated full suites repeatedly.

**Current handover boundary:** new layout migration unfinished; fresh visual
verification, affected lint/build and functional regressions remain required.
No production changes or release actions were performed for this handover.
