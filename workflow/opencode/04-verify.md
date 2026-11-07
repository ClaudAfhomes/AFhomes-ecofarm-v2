# 04 — Verify

## Recommended agent/mode

Use the available **Build** agent/mode to run and fix in-scope checks, or a separate verification/reviewer agent if configured.

## Change under verification

[Describe the change and/or identify the relevant diff or commit.]

## Testing and verification

### Steps

1. Inspect the current Git status and diff before running checks.
2. Read applicable `AGENTS.md` instructions and identify the project's existing scripts and test conventions.
3. Map the changed behavior to relevant unit, integration, end-to-end, API, or regression tests, as applicable.
4. Run the narrowest relevant tests first, then broader checks when practical: targeted tests, related test suite, lint and formatting checks, type checks, build checks.
5. Review test output and investigate failures rather than assuming their cause.
6. If a test is missing, recommend a test that would meaningfully verify the behavior.
7. Inspect the diff for accidental changes, debug code, leaked secrets, weakened assertions, and unrelated edits.

### Rules

- Do not install dependencies or change project configuration just to get a green result without approval.
- Do not alter production data or run destructive commands.
- Do not remove, skip, or weaken tests to conceal a failure.
- Do not claim a check passed unless it actually completed successfully.
- Clearly distinguish passed, failed, blocked, and not-run checks.
- Do not make unrelated fixes. Ask before expanding scope materially.

### Report

Provide a table with the check, exact command, result, and notes. Include what was verified, what failed and the evidence, what was not verified and why, any test gaps or residual risks, and whether the evidence supports considering the change ready for review.

## Code review

### Review target

[Describe the task, branch, diff, or files to review.]

### Review priorities

1. Correctness.
2. Security and privacy.
3. Data integrity.
4. Compatibility.
5. Reliability and performance.
6. Maintainability.
7. Tests.
8. Documentation.

### Rules

- Inspect the actual diff and relevant surrounding code.
- Base findings on evidence. Reference file paths and line numbers when available.
- Do not report speculative issues as confirmed defects.
- Do not flag style preferences as bugs unless they violate project conventions or materially reduce maintainability.
- Prioritize actionable findings by severity: Critical, High, Medium, Low.
- Explain impact and concrete remediation for each finding.
- Do not edit files, run destructive commands, or claim tests were run unless they were run.
- If no findings are identified, state that this is not proof that the code is defect-free and list important areas not verified.

### Report format

1. Findings ordered by severity, each with evidence and remediation.
2. Missing tests or coverage gaps.
3. Checks performed and their results.
4. Areas not reviewed or unable to verify.
5. Overall recommendation: approve, approve with follow-up, or request changes, with a brief reason.

## Security review

### Scope

[Describe the feature, endpoints, auth flow, input fields, file handling, or other security-sensitive area.]

### Review areas where applicable

- Authentication and session management.
- Authorization and object-level access control.
- Input validation and output encoding.
- Injection risks, unsafe deserialization, path traversal, and file upload/download handling.
- CSRF, XSS, SSRF, and other web risks relevant to the stack.
- Secrets management, logging, and sensitive data exposure.
- Password handling, token lifecycle, rate limiting, and abuse controls.
- Dependency and configuration risks that can be verified from repository files.
- Database access, tenant boundaries, and data integrity.
- Error messages and audit logging.

### Method

1. Trace trust boundaries and identify attacker-controlled inputs.
2. Follow each relevant input to validation, authorization, sensitive operations, and output.
3. Inspect existing protections and tests.
4. Describe concrete attack preconditions and impact without overstating certainty.
5. Recommend prioritized mitigations compatible with the existing architecture.

### Rules

- Do not expose secret values in your report.
- Do not modify files in this review phase.
- Do not attack live systems, access data without authorization, or run destructive security tests.
- Do not claim a vulnerability solely because a protection is not visible in one file; inspect the relevant call path or mark it unverified.
- Do not claim the system is secure or fully audited based on a limited review.
- Ask before expanding the scope or running active tests.

### Report

For each finding, include severity, affected path/symbol, evidence, preconditions, impact, recommended fix, and suggested regression test. Also list areas not verified and the limits of this review.