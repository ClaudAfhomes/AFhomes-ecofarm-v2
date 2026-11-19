> RA update, 8 November 2026: separate RA review, downloadable and printable RA draft are implemented. The single RA draft migration was explicitly approved, applied and verified. See [RA-DRAFT-REVIEW-2026-11-08.md](RA-DRAFT-REVIEW-2026-11-08.md).

> Prefix update: local implementation is complete and the single Prefix migration
> was applied to the configured Supabase project after explicit user approval. See [PREFIX-AND-HOLDER-FLOW-2026-11-08.md](PREFIX-AND-HOLDER-FLOW-2026-11-08.md)
> for exact scope, hash, checks and live verification. The earlier Prefix
> proposal below is historical.

> Update, 8 November 2026: the earlier status below is historical. See
> [V4-VISUAL-COMPARISON.md](V4-VISUAL-COMPARISON.md) for the copied-reference
> implementation, current screenshot evidence, checks and verification limits.
> Prefix persistence remains pending as documented below.

# Customer Application V4 continuation

Scope: `claud/supabase`, Supabase/PostgreSQL. Claude's team validation,
AAO/contact lookup, shared hierarchy, compact referrer verification, sidebar,
ID preview, civil-status tiles and free-text suffix are retained.

## Completed UI and document scope

- One compact Bronze/Silver/Gold selector in the persistent preview pane.
- Selected card and summary remain visible; plan benefits expand independently.
- Seven-step progress indicator with an expandable, validation-gated step menu.
  Existing step state, query parameters, edit targets and routes are retained.
- Review offers Print Application and Download PDF from the actual draft values.
  The print preview uses the existing accessible Dialog. Output is A4 portrait,
  follows the supplied official form's section order, and includes the primary
  holder, optional Gold secondary holder, plan/payment terms, network contacts,
  channels and certification. Signature/date lines remain blank. Omissions are
  marked `Not provided`; certification is explicitly confirmed or unconfirmed.
- Output is labelled unsigned/unsubmitted. It neither saves nor submits, makes
  network requests, verifies an ID, nor creates a reservation/payment record.
  JPEG-backed PDF pages preserve Unicode names using the browser's fonts. Long
  values wrap and additional A4 pages are added rather than truncating data.
  The PDF is a raster document, not searchable text or an accessible tagged PDF.
- Company name is reproduced from the supplied paper reference. No unverified
  company contact details, signatures, payment amount or verification are invented.

## Prefix: pending separate authorization

Current evidence: `applicationHolderSchema` and `storedApplicationHolderSchema`
in `packages/contracts/src/schemas/official-forms.ts` have `suffix`, but no
`prefix`. `public.customer_application_holders` has no Prefix column. No Prefix
control, contract change, migration or remote write is included in this task.

The minimal future persistence change, subject to an approved value policy:

1. Add nullable `public.customer_application_holders.prefix text` in one new,
   forward-only, idempotent `afhomes_` migration. Proposed bound: 20 characters,
   matching the optional free-text suffix's size; confirm the desired vocabulary
   before implementing. Existing records remain NULL; no inferred backfill.
2. In that same migration, replace the current
   `public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb)` body with the
   existing behavior plus `prefix` in BOTH PRIMARY and SECONDARY holder INSERT
   column/value lists, sourced from `nullif(p_primary->>'prefix','')` and
   `nullif(p_secondary->>'prefix','')`. Latest definition is in
   `20261210000001_afhomes_mirror_referral_names_on_customer.sql`; preserve its
   authorization, snapshots, mirror, transaction and service-role-only grants.
   Adding a column alone would silently discard Prefix on every save.
3. Add optional trimmed `prefix` to the write and stored holder contracts;
   propagate through inherited create/register/draft/read schemas. Add it to
   `shapeApplicationHolder` in `api/_handlers/official-forms.ts`. Holder writes
   already pass JSON to the RPC. Keep it separate from first/last/printed names;
   do not silently change customer identity or historical name snapshots.
4. Only after persistence is authorized, wire primary/secondary holder fields,
   prefill/draft handling, review and this document's name rendering. Add contract
   and real PostgreSQL roundtrip tests for both holders, NULL legacy records,
   length rejection and existing permissions. Regenerate the schema index after
   an approved migration change. Remote application needs separate approval.

This minimal scope stores Prefix on the Customer Application holder only. Copying
it into customer identity, imports, reservation holders or historical exports
would require a separately agreed data contract; those modules are not changed.
Free-text Suffix remains unchanged.

## Files changed by this continuation

All application files below are under `apps/admin/src/features/business/`:

- `ApplicationChoiceCards.tsx`, `ApplicationChoiceCards.module.css`: optional
  segmented presentation for the one persistent VIP selector.
- `ApplicationProgress.tsx`, `ApplicationProgress.module.css`,
  `ApplicationProgress.spec.tsx`: compact progress, guarded step menu and focus.
- `official-forms-applications.tsx`, `OfficialFormsPages.module.css`,
  `OfficialFormsPages.spec.tsx`: application integration, preview and benefits.
- `ApplicationReview.tsx`, `ApplicationReview.module.css`,
  `ApplicationReview.print.spec.tsx`: document actions, accessible preview,
  loading/error handling and no-submit integration coverage.
- `application-print.ts`, `application-print.spec.ts`: current-value paper rows,
  font readiness, text wrapping, pagination, A4 PDF and isolated printing.
- This completion note. The supplied HTML/JPG references are unchanged.

The existing dirty server, contract, holder, sidebar and other Claude changes
were preserved, including the pre-existing removed NetworkSelection component.

## Verification boundary

The supported computer-use inventory reports `The browser access host is
unavailable`; there is no accessible authenticated browser surface. Cloudflare
Turnstile is unchanged. Component/integration tests and build checks are local
proof only. No pixel-perfect or authenticated visual acceptance is claimed.
No database changes, commits, pushes or deployments are part of this continuation.

Focused proof includes 65 application/progress/document tests, 77 preserved
holder/action/import tests, 14 server team/AA-lookup tests and 29 contract tests.
A standalone synthetic Gold document was rendered in headless Chrome and its
image reviewed against the supplied form. Unicode names, visible company header,
missing-field labels, unconfirmed certification and blank signature/date lines
fit one A4 page. An independent pypdf strict read validated the actual generated
PDF and its 595.28 × 841.89-point page. This synthetic document check is not
authenticated application-screen verification.

Final checks: admin TypeScript + Vite production build PASS; API typecheck PASS;
affected-file ESLint PASS with one pre-existing Fast Refresh export warning.
The build retains existing bundle-size warnings. The seven font/print/progress
tests were rerun successfully after the final timer-type and focus adjustments.
No application dependency was added. Temporary synthetic document evidence is
kept under ignored `.tmp-bin/`; no customer data was used for that check.
