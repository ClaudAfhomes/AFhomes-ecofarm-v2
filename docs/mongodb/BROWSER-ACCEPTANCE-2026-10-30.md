# Browser acceptance - 30 October 2026

Scope: the user's running `http://localhost:5184` MongoDB app, signed in by the
user as the existing Super Admin. Native Chrome interaction used the existing
session. No administrator, permission or business record was changed by these
checks. Personal record names, contact details, card numbers and screenshots are
not copied into this report.

| Check | Result | Browser evidence |
| --- | --- | --- |
| Existing Super Admin dashboard | PASS | Signed-in dashboard rendered metrics and Sales/Finance/Network/Organization navigation without an error banner. |
| Disabled modules | PASS for navigation | Reports, CMS, Services and Redemption were absent from the observed sidebar. Direct-route/API denials were not retested here. |
| Customer Lookup navigation/search | PASS | Sidebar opened lookup; a two-character search offered existing active VIP suggestions and selecting one displayed its record. |
| VIP card identifier | PASS | The selected existing VIP displayed a nonblank card number and validity. |
| Weekday/weekend points | PASS | Total 2,000, weekday 1,400 and weekend 600 were displayed. |
| Full browser reload/session | PASS | Chrome Reload created a new document, cleared the transient search and retained the signed-in session. Repeating the search returned the same card identifier, validity and points split. |
| Customer directory/detail | PASS for reads | Directory loaded existing records and opened the same customer's detail route. |
| Customer overview scrolling | PASS | A native wheel scroll moved from the top summary to lower Membership, Points and Actions sections. The lower points display matched lookup. |

These are read checks on an existing account, not a newly created purchase or
evidence of every role's access. Browser console/network statuses have not yet
been inspected. Rendering without an error banner is not a zero-error claim.

## Disposable write-flow environment

`pnpm dev:mongodb:local` now binds its API and both Vite apps to `127.0.0.1`,
using a different hostname from the real localhost cookie jar. It still uses
`createTestReplica()` and synthetic fixtures only, never reads `.env.local` and
never connects to Atlas. Public-search test hostname configuration matches the
new loopback hostname. The user's real localhost process is left running.

The fresh fixture started successfully. CLI probes for its sign-in page and
proxied health returned HTTP 200. This is startup proof, not browser workflow
proof. Dynamic URLs and fictional QA credentials are in ignored local Git
metadata; they are not part of the repository report. The user has been asked to
perform the synthetic first-login password change and report the sign-out/redirect
result before further authenticated browser actions.

Computer Use requires a handoff for entering and submitting a new password.
No existing administrator password is used, requested, recovered or reset.

## Synthetic first-login continuation

The user confirmed the first-login password change automatically returned to
login. Native Chrome subsequently showed the synthetic Super Admin signed back
in at the disposable QA origin, with its dashboard loaded. The redirect itself
is user-confirmed; it was not observed through an automated password submission.
A separate request to that loopback QA API using the original fictional
temporary password returned HTTP 401, confirming it no longer signs in. The new
password was not requested, read or logged. Rejection of the pre-change browser
cookie was not independently checked in this checkpoint.

The browser application wizard opened, offered the synthetic Bronze plan and
advanced to Identity after selection. No application was submitted. A clearly
labelled `SYNTHETIC QA / NOT A VALID ID` PNG was prepared in ignored local
storage for the upload test. The Windows file chooser accepted its path, but
automation could not confirm Open reliably: native targets reported unavailable
cached elements and coordinate hits outside the bound parent window. The user
was asked to click Open manually. This is a browser-tool blocker, not an observed
application upload rejection; upload/storage verification remains pending.

The user subsequently confirmed the file chooser selection. The browser showed
the synthetic image preview and `Ready to upload on save`; choosing Other cleared
the identity-step blocker. This is client selection/validation proof, not a
completed server upload. Fictional holder fields, native segmented birth date,
the reference Laguna/Alaminos/San Juan address and automatic postal code 4001
were entered. Browser autofill was noticed and its personal name/email/office
values were replaced with fictional data before any submission. The hierarchy
selectors accepted synthetic SVD, SSM and SM records and correctly cleared lower
levels when a higher level changed. The wizard reached Certify, but was not
submitted; the user later navigated the QA tab to Roles.

The user's separate report of blocked membership transactions/history was
investigated next. Native browser checks on the disposable membership card now
confirm those disabled panels are absent, Points loads, and card controls remain.
An active Payments read exposed an incomplete original synthetic payment row;
its fixture definition and native HTTP regression were corrected, but the
already-running fixture row remains unchanged. See
`MEMBERSHIP-DISABLED-PANELS-FIX.md` for the exact checks and remaining limitation.

## Remaining browser gates

- Complete independent old-session rejection verification. First-login redirect
  is user-confirmed, authenticated return is observed and the old temporary
  password is rejected by the QA API.
- IST/OST creation, blank repeat-create forms, immediate OST accreditation,
  public eligibility/search and photo delivery.
- Full application, approval, reservation, recorded/verified payment, purchase
  finalization, membership activation, VIP activation-link ownership and points.
- Workbook upload, per-cell flags/explanations, retained-value review download,
  correction/re-upload, confirmation and reload persistence.
- GSD and each sales role's own navigation, lookup/participation access and denial
  paths; private documents and console/network checks.

Do not mark full browser acceptance complete from this partial checkpoint.
