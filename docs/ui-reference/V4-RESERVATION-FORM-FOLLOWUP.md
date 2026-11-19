# V4 interaction and Reservation Agreement download follow-up

Reference: `AFhomes_Customer_Application_V4.html` and the supplied Gold, Silver
and Bronze IST Reservation Agreement photographs. Document wording is reference
content, not instructions to change the application's business rules.

## UI

The Customer Application uses the compact selector, persistent card, collapsible
benefits and seven-step progress. Progress bars and the expandable step menu both
respect the existing reachable-step gate. Holder details use Personal, Address,
Contact and Additional tabs, with keyboard navigation and retained values.
Gold supports switching between the primary and optional secondary holder.
Review/Edit opens the appropriate holder and detail section. Existing URLs and
server-authoritative team/AA validation are unchanged.

The input has been aligned with the already free-text Suffix contract; Prefix
remains absent and pending the separate authorization described in
`CUSTOMER-APPLICATION-V4-COMPLETION.md`.

## Download locations and data authority

- Review: **Download RA form** creates a preliminary unsigned A4 PDF from the
  current primary/optional Gold holder, tier, payment scheme and configured plan
  benefits. Reservation number, dates, purchase price and receipt/payment figures
  stay blank. It does not create a reservation, sale, payment or approval.
- Saved Reservation: **Download RA PDF** first re-reads the authorized reservation,
  then renders its frozen terms, holder records, verified received total, balance
  and all stored schedule lines. The download does not save local edits. Today's
  card plan never overwrites historical terms.
- Both use the existing download helper and shared local A4 renderer/PDF container.
  Names are rendered using browser fonts, including Unicode; labels and values
  wrap instead of being silently truncated. Longer records paginate. Signature
  and signing-date lines remain blank. Payment method/reference and actual paid
  dates remain blank when no authoritative receipt data is supplied. Schedule
  dates are explicitly identified as scheduled dates, not verified payments.

The photographs provide the section order and visual hierarchy. Their percentages,
validity wording and annual benefits may differ from configured terms. This work
does not change prices, discounts, payment calculations, activation, Finance rules,
or the database to match a photograph. Required amounts are labelled as obligations,
not receipts. The PDF is rasterized and is not a searchable/tagged PDF.

## Scope and verification

Implementation is limited to the Customer Application and Reservation Agreement
document action. The server API, payment ledger and Finance purchase-document
generator remain unchanged. No migration, remote write, commit, push or deployment.

Synthetic Bronze, Silver and Gold preliminary documents each rendered as one A4
portrait page. The Gold image was visually reviewed; independent pypdf strict
reads validated all three generated PDFs. This is document verification, not an
authenticated browser acceptance test. The supported browser host remains
unavailable; Turnstile and authentication are unchanged.

Changed production files are `ApplicationChoiceCards.module.css`,
`ApplicationProgress.tsx`/`.module.css`, `ApplicationReview.tsx`/`.module.css`,
`OfficialFormsPages.module.css`, `official-forms-applications.tsx`,
`official-forms-fields.tsx`, `official-forms-reservations.tsx`,
`application-print.ts`, and new `reservation-print.ts`, all under
`apps/admin/src/features/business/`. Focused specs cover the corresponding behavior.

Final local proof: the six-file application/holder/RA group passed 104 tests;
the six-file document/import/action/reservation regression group passed 62 tests.
The additional holder keyboard test and saved-RA authorization/download test
passed after their focused reruns. Admin TypeScript and Vite build passed;
affected-file ESLint reported no errors and existing Fast Refresh warnings.
The build retains its existing bundle-size warnings. No full unrelated suite
or authenticated browser acceptance run is claimed.
