# Phase 1 validation cleanup

25 October 2026. Local target repository only. This continues Phase 1 and does
not implement authentication replacement or MongoDB business workflows.

## Findings and changes

- The downloaded membership workbook has an intentional `Examples Guide` tab;
  the workbook parser already allows it. Updated the exact tab assertion without
  changing the workbook or dropping its column, access-control or import checks.
- Two browser reads of `import.meta.env.VITEST` violated the environment guard.
  Replaced them with the allowed Vite built-in `import.meta.env.MODE === 'test'`.
  This preserves the existing test-only draft-storage behavior; the scanner and
  server-only variable list were not relaxed.
- The geographic form retained free-text legacy addresses but omitted its promised
  unverified notice. It now announces the notice without inventing codes or changing
  the stored address. Tests check its presence and removal after official selection.
- The purchase workflow calculated navigation destinations but rendered no action,
  and approved applications with no reservation fell through to `Continue draft`.
  Restored the existing next-step navigation and the approved-application reservation
  destination. No endpoint or lifecycle rule changed. A successful reservation
  lookup is required before showing an action; lookup failures expose Retry.
- Approval failures were reported by the mutation's `onError` and again by the
  surrounding async button handler. Removed the duplicate report. The regression
  test requires one warning and no approval/terms-review request for a legacy
  application without frozen purchase terms.
- Several application tests expected retired exports/cancellation controls, hidden
  non-draft forms, old labels, or decorative timeline characters. Tests now cover
  the current record actions, semantic timeline state and actual navigation.
  Added explicit non-draft edit-route read-only checks; did not restore removed
  export/cancellation controls or add an extra commission navigation action.
- Wizard tests attempted to use Submit on intermediate steps and type into a
  recommender dropdown. They now verify Next is blocked for invalid landlines,
  no business write occurs, and arbitrary dropdown values cannot be entered.
  The lowercase-email fixture now selects the VIP recommender whose email it
  expects, rather than a different referrer.
- The contact dropdown also incorrectly offered email addresses as phone values.
  A failing regression reproduced the problem. It now offers only phone values
  accepted by the existing shared contact-number schema; email remains in its
  own dropdown. Tests reject alphabetic and too-short stored phones.
- Earlier workbook timeouts passed in isolation. The full API suite also passed
  with one worker and unchanged timeout limits. Validation is scheduled with
  bounded parallelism instead of running many compilers and test suites at once.

## Validation

The normal repository command `corepack pnpm test` passed with exit 0:

| Workspace | Files | Tests |
| --- | ---: | ---: |
| API | 141 | 2,715 |
| Admin | 102 | 994 |
| Web | 22 | 265 |
| Contracts | 22 | 313 |
| Config | 1 | 6 |
| Shared | 6 | 51 |
| UI | 32 | 230 |
| **Total** | **326** | **4,574** |

All seven configured test tasks passed in the same final run. No test timeout,
retry policy, scanner allowlist or root test concurrency setting was changed.
No tests were skipped to obtain this result. Existing jsdom media/scroll/navigation
notices and existing markup warnings remain; they did not fail the suite.

The earlier admin run overlapped the final navigation edit and was stopped after
its targeted checks passed. It is not counted as final acceptance; the complete
standard-command run above used the final files.

Final checks on the unchanged source all exited 0:

| Command | Result |
| --- | --- |
| `corepack pnpm typecheck` | PASS: all seven workspace typechecks plus the operator TypeScript check; unchanged workspaces reused valid cache entries |
| `corepack pnpm lint` | PASS: no errors; existing warnings remain |
| `corepack pnpm build` | PASS: both SPAs; unchanged build artifacts reused from the successful build in this cleanup |
| `corepack pnpm check:env -- --built` | PASS: 701 browser and 296 server source files plus built assets checked; server-only variable protections retained |

The target remains on local `claud/develop`; nothing is staged or committed.
The inspected source checkout remains clean and `.env.local` remains ignored.
Detailed local evidence is in ignored `.phase1-cleanup-final-*.log` files.

## Limits

No database writes, migrations, source-repository changes, credential edits,
commits, pushes or deployments. Redemption and Services remain disabled by the
real default flags; explicit feature-on fixtures retain source-module coverage.
Unit/DOM tests do not prove live authentication, browser persistence, hosted
permissions or MongoDB workflow parity. Database integration and authenticated
browser acceptance are outside this cleanup's scope.
