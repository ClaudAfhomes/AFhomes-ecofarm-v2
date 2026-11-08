> Later user changes: Prefix and the holder Continue/secondary layout were
> implemented after these screenshots. Current evidence and the pending database
> approval are in [PREFIX-AND-HOLDER-FLOW-2026-11-08.md](PREFIX-AND-HOLDER-FLOW-2026-11-08.md).

# V4 implementation and verification ? 8 November 2026

Source: `AFhomes_Customer_Application_V4.html` in this directory. Branch:
`claud/supabase`. Local changes only; no migration, production write, commit,
push or deployment.

## Implemented

The new Customer Application uses the approved stylesheet, scoped as
`CustomerApplicationV4.module.css`, with React markup retaining the existing
state, contracts and Supabase service calls. It has normal page scrolling, a
sticky left card, one tier selector, compact seven-step progress, reference
payment/ID tiles, holder tabs and civil/sex choices, compact RA-number controls,
one shared sales hierarchy, acquisition chips, certification boxes and six
Review summaries. Review keeps Print Application, Download PDF and Download RA
form. Collapsed module icons can expand their permitted navigation again.

Main files: `official-forms-applications.tsx`, `official-forms-fields.tsx`,
`ApplicationChoiceCards.tsx`, `ApplicationProgress.tsx`, `ApplicationReview.tsx`,
`CustomerApplicationV4.module.css`, `AdminLayout.tsx`/CSS, shared AppShell/CSS,
Sidebar and IdCapturePicker. Existing backend/team/AA changes were preserved.
The transient JSX separator error reported by the user was repaired and followed
by compilation and regression checks.

## Screenshots actually generated

Ignored local evidence directory: `.tmp-bin/v4-comparison/` at the repository root.

- `reference-1440x900-step0.png` through `step6.png`, and equivalent
  `1920x1080` and `390x844` files: actual approved HTML, Gold, synthetic holder.
- `component-1440x900-step0.png` through `step6.png`, and equivalent desktop/mobile
  files: actual React editor, AdminLayout and shared components, with isolated
  test session/query-cache fixtures. These are **component screenshots**, not
  authenticated Supabase workflow screenshots. The harness is ignored under
  `.tmp-bin/`, served separately on loopback 5187, with its own Vite cache.
  External/API requests were blocked in this browser context; no test records
  were submitted.
- `measurements.json`: panel bounding boxes, overflow checks and page errors.
  All seven desktop panel x/y/width values matched the reference in both sizes.
  Application, Identity, Certify and Review panel heights matched at desktop;
  other heights differ with actual content. No horizontal page overflow and no
  page errors were recorded across the 21 paired states.
- `component-holder-address.png`, `component-holder-contact.png`,
  `component-holder-additional.png`, `component-gold-secondary.png`: additional
  actual holder presentations. A later scoped adjustment makes the unverified
  address notice span both columns instead of displacing the Province field.
- `customer-application.pdf`, `reservation-agreement.pdf`: actual downloads from
  Review, using synthetic values. Their header, EOF, A4 media box, image stream
  and xref offset were checked. Extracted first pages are `*-page1.jpg` and were
  visually inspected. Signature/date and unrecorded payment fields stay blank.

The native browser tool also read the real logged-in localhost application after
refresh and displayed the Identity screen without the error overlay. The full
seven-step authenticated flow at the three fixed viewports was **not** verified:
fixed-size comparisons used the isolated component harness. Native input actions
were unreliable (geometry/URL enforcement errors); authentication and Turnstile
were not changed to work around them. No pixel-perfect or end-to-end production
claim is made.

## Functional checks

Focused application/document suites passed (113 checks before the final compact
review test; the changed OfficialFormsPages and print-review suites then passed
40 checks, including that additional test). Shared AppShell, Sidebar and camera
picker suites passed 23 checks. Admin build includes TypeScript checking; shared
UI typecheck passed. Affected-file ESLint: zero errors, 16 existing Fast Refresh
export warnings. Build retains existing large-chunk warnings.

Logs are ignored under `.tmp-bin/`: `v4-acceptance-tests.log`,
`v4-final-regression.log`, `v4-shared-final-tests.log`, `v4-ui-final-types.log`,
`v4-final-lint-proof.log`, `v4-final-build-proof.log`, `v4-capture-final.log`.
PowerShell logs may wrap native stderr as NativeCommandError; use the recorded
process exit and decisive test/build output rather than treating stderr alone
as failure or success.

## Deliberate differences and limits

- Prefix is not implemented because it cannot persist in the current schema.
  Minimal authorized follow-up is documented in
  `CUSTOMER-APPLICATION-V4-COMPLETION.md`; no migration was added. Desktop holder
  layout reserves that position; mobile omits the unavailable control.
- Real catalog artwork/values, authorized modules, validation/status messages,
  PSGC comboboxes and camera/upload handling replace demo data and behavior.
  The prototype's fake submission/banner/sample staff are not shipped.
- The added RA download makes the mobile Review action area taller. Longer real
  address/verification text also changes vertical height. These were not hidden
  to force a screenshot match.
- PDFs preserve existing raster-page rendering; they are not searchable/tagged
  accessible PDFs. Actual printing, camera hardware and remote submission were
  not exercised. Download/print actions do not submit the application.
