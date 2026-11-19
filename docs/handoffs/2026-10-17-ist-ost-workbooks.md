# IST / OST guided import and export

Release preparation updated 2026-10-18 on `claud/develop`, parent
`bdf5f6c93efc22eb3c7574f9dccdcc833c705c0c` (renewal shortcut already pushed).
Working checkout: `C:/Users/SSD-CLAUD/Documents/AFhomes-claud-develop-ost-release`.
Scoped commit/push target is only `origin/claud/develop`; the push may trigger its
automatic Preview build. No production deployment/promotion is included. No database SQL,
live accounts, installs, dependencies or migrations were changed.

## Approved design and resulting behavior

Match the customer bulk workbook's design and controls, not its headers. Actual
customer source inspected: `packages/contracts/assets/customer-company-template.xlsx`,
the current customer-template download. Its original ten tabs and macro-free
offline PSGC lists were verified by inspecting ZIP/XML, without opening macros.

Members -> Import / export offers separate IST/OST template downloads and
read-only roster exports. Templates contain README, Identity, Team, Details,
Accreditation, active Teams, Postal and the five existing PSGC lookup tabs.
Prepared entry cells use Text format, preserving leading-zero mobiles. Dropdowns
cover roles, immediate heads, AA mode, ID types, personal/form choices and dependent
province/city/barangay. Age, ZIP and annual OST expiry have convenience formulas.
Generated matching row keys detect one-tab sorting/misalignment. Limit: 500 rows
and 8 MB per upload; templates contain no customer entry data or passwords.

Read-only preview validates strict headers and aligned keys, rejects non-derived
formulas, recomputes derived values, resolves addresses using the existing provider,
checks duplicates including 09/+63 equivalence, checks existing role/team chains,
role-assignment permissions, manual AA conflicts and canonical creation contracts.
Conflict queries are batched; per-scope address lookups are reused. Failed or
truncated reference reads block workbooks rather than returning partial data.

Confirm generates an individual temporary password in memory and calls the existing
Create IST or completed Create OST endpoint sequentially. Each endpoint rechecks its
normal permissions and business rules. No alternate provisioning SQL exists. OST
retains its signature and management-approval requirements. Heads must already exist:
import VD, then SSM, then SM, then OST. Imports never update, renew, convert or move
existing members. A failed row stops the batch, retains completed results, displays
credentials once, and disables automatic retry of the consumed preview. Inspect
the member/application after an ambiguous response before starting another import.

Exports exclude passwords, TIN and ID numbers; they are reports, not re-import/update
templates. OST phones come from ost_members even when an IST profile is absent.
Google Sheets integration uses a private sheet downloaded as XLSX; no public sharing,
credentials, Google API client or account connection is required.

## Verification

- API/workbook/customer regression selection: 186 tests passed on 2026-10-18.
  The 1904 Excel regression first reproduced a birthday shift (1990-01-01 became
  1985-12-31), then passed after using the existing customer date converter with
  workbook metadata. Numeric dates now honor the 1900/1904 date system.
- Admin workbook, Members, member-detail renewal shortcut and OST suites: 64 tests
  passed on 2026-10-18 (existing jsdom scrollTo warnings). First-row response-loss
  regression first failed, then passed: list refresh occurs even on an ambiguous
  first-row failure; creation remains consumed and is never retried automatically.
- Workspace typecheck passed; scoped admin ESLint passed.
- Admin and web production builds passed; existing chunk-size warnings remain.
- Earlier local Chrome check (2026-10-17), synthetic API fixture: preview rendered; explicit checkbox required;
  approval enabled Create; desktop and 390px mobile dialog/body had no horizontal
  overflow. No creation clicked. No failed requests. Fixture favicon returned 404;
  this was the sole browser console error. Screenshots inspected locally.
- git diff --check passed. Original checkout's 11 unrelated changes remain preserved.

Browser evidence is ignored under `.tmp-bin/member-ui/` in the integration checkout.
The UI server and isolated Chrome used only synthetic records and were stopped.

## Limits / next verification

Excel Desktop/Web and Google Sheets opening, dropdown search, recalculation and
XLSX re-export have NOT been exercised in those applications. Date/search controls
vary by host; literal ISO dates and server validation remain required. No live
authenticated account creation, forced password change, reload persistence or
large-volume performance was verified. This is local proof, not live acceptance.
Roster references currently reuse a single existing list response with exact-count
checks; if a server cap truncates it, the feature blocks and needs pagination.
Preview data stays in memory; there is no resumable server import-job ledger.

No new remote action is authorized by this note. A future scoped commit/push target
is ONLY `origin/claud/develop`; migration apply or production deployment needs its
own scope. Do not stage original user changes or ignored browser artifacts.
