# CLAUDE.md

@AGENTS.md

`AGENTS.md` (imported above) is the authority for this codebase; this file adds Claude Code routing only.

## Automatic Specialized Subagent Routing

1. Classify the task by domain: frontend, backend/API, database/SQL, devops/build/env, QA/tests.
2. Small task (one label, class, import, message, one-file fix): do it directly. No subagent.
3. Medium task: stay in the main agent unless ONE matching project agent (`afhomes-frontend`, `afhomes-backend`, `afhomes-database`, `afhomes-devops`, `afhomes-qa`) has a clear benefit. Prefer an existing agent over a new one.
4. Large task: delegate a piece only when it is separable AND has a concrete benefit you can name — e.g. one layer needs ~15+ file reads and only its conclusion or diff must return. Multiple layers alone is not a reason. Coupled pieces stay in the main agent.
5. Concurrency: at most two specialists at once, non-overlapping file ownership. Dependent steps run sequentially (contracts/rules → database → backend → frontend → qa); the main agent fixes contracts and rules first.
6. Repo-wide discovery: main agent or ONE built-in `Explore`; never several specialists.
7. Each delegation states objective, file scope, expected result, restrictions. Never delegate the same investigation twice or to summarize known facts. Load only skills the task needs; read no unrelated files.
8. Shared working tree: other sessions may edit here. Before editing, note `git status --short`; re-read a file right before changing it, use Edit (not Write) on existing files, and stop and report if a target changed unexpectedly. Never revert or overwrite changes you did not make.
9. High-risk change (authorization, money/commission/payout, migration/RLS/`SECURITY DEFINER`): before reporting done, get one independent review — `backend-design:security-reviewer` or `backend-design:schema-reviewer`, or a fresh specialist given the diff, not your conclusion. Skip for read-only or trivial changes.
10. Specialists default to `sonnet`; pass `model: "opus"` only for financial concurrency, critical authorization/security, or complex migration design.
11. Specialists return concise findings (paths, test evidence, blockers, next step). The main agent integrates, verifies, owns final correctness, and reports only subagents actually invoked.

## AFHomes business-rule guardrails (all agents)

Details live in `AGENTS.md` and `docs/business-rules/` (start at `INDEX.md`, `AGENT-GUIDE.md`, `OPEN_QUESTIONS.md`). Never invent a missing financial, contractual or authorization rule; report it as an open question.

- New sales may be originated by active SM accounts and by Admins / Super Admin (highest authority). OST cannot originate sales. (User-confirmed 2026-11-11.)
- Signed application and RA evidence must be genuine; payment verification requires valid evidence.
- Overpayments are rejected.
- VIP Card ID issuance follows the first verified qualifying non-reservation payment.
- Commission eligibility begins at 40% verified settlement; payout needs separate authorization.
- Membership activation requires full verified settlement, and is a manual Finance step (no auto-activation). (User-confirmed 2026-11-11.)
- Finance is one role that records AND verifies a payment in one flow (amount + purpose → proof upload → review → verify and record). Purposes follow the stage: reservation fee, then down payment, then installments/full; a completed stage cannot be recorded again. (User-confirmed 2026-11-11.)
- Signed documents: the person who uploaded a document may also review it (no second reviewer required). (User-confirmed 2026-11-11.)
- Imports: the seller of record is always an active SM, same as new sales. A VIP Card number that already exists in the system (or twice in the file) is never imported; the row is flagged in the Excel file. (User-confirmed 2026-11-11.)
- UX goal: fewer clicks with accurate, human-readable steps — one "next step" action per record, pre-filled values, impossible choices disabled with a reason. (User-confirmed 2026-11-11.)
- Points: the annual cap follows the card tier; the balance at activation is 0 — points are earned only by spending on AF Homes services/products. (User-confirmed 2026-11-11.)
- IST payroll authority (user-confirmed 2026-11-12): Finance reviews, submits batches and records disbursements; Super Admin approves/returns batches and closes payroll periods, via dynamic RBAC permissions (no hardcoded role names, no separate Director role); SM/SSM/SVD get no approval authority; a batch is never approved by its submitter.
- NOT approved, never activate (2026-11-12): historical BA/PA/PB amounts, targets and PB rates (test fixtures only); new DRI entitlements; automatic commission release at 40%; the 25% Closed Deal threshold; automatic deductions or clawback recovery; new refund/reversal authority; performance-based auto-termination; assumed-credit percentages; automatic bank transfers. Build the supporting structure and keep payable amounts blocked until an approved policy is configured.
- Official identifiers are immutable; historical data and identifiers are preserved.
