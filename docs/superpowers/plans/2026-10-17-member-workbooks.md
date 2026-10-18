# IST/OST workbook implementation plan

**Goal:** Match the customer workbook's design and controls, using member fields.
**Design approved in chat:** README, aligned entry tabs, dropdowns, text mobiles,
dependent PSGC addresses, automatic derived fields, preview before confirmation.
**Architecture:** Reuse the customer OOXML reader/writer and reference workbook.
Resolve uploaded locations and team emails server-side. Confirm individual rows
through existing Create IST/Create OST APIs; do not duplicate provisioning SQL.
No migration, dependency, remote operation, commit or push is part of this build.

1. Workbook contracts and renderer: Identity, Team, Details, Accreditation tabs;
   README, current active team choices, existing PSGC lookup data. Ignore derived
   formula cells, never evaluate arbitrary uploaded formulas. Test round trips.
2. Read-only preview: strict headers, aligned rows, existing team/AA/identity
   conflicts, canonical address resolution and creation-contract validation.
   No passwords in preview persistence; generate individual credentials at confirm.
3. Members dialog: template/export downloads, XLSX upload (including private
   Google Sheets downloads), visible errors, explicit create approval, sequential
   creation with progress and stop-on-failure; no automatic uncertain retry.
4. Tests: parser/template hazards, wrong teams, duplicates, address failure,
   UI approval and partial-failure handling; typecheck, lint and build.

Imports create new accounts only. Heads must exist first: VD, SSM, SM, then OST.
OST completion requires real signature dates and approved annual start. Exports
are read-only rosters, exclude passwords/TIN/ID numbers, and cannot overwrite
existing accounts. Credentials are displayed once after explicit confirmation;
do not put them in audit, local storage, workbook templates or normal exports.
Spreadsheet validation is convenience; creation APIs remain authoritative.
