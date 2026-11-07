# 04 — Review and Security

This file holds the independent code review and security review templates. It uses `AGENTS.md` and the repository as authority. Graphify and Obsidian are navigators only.

## Code review

### Recommended agent/mode

Use a separately configured read-only reviewer if available. Otherwise use a read-only/Plan mode and verify edit permissions are restricted.

### Review target

[Describe the task, branch, diff, or files to review.]

### Review priorities

1. **Correctness:** Does the code meet approved requirements? Logic errors, missing cases, race conditions, incorrect assumptions.
2. **Security and privacy:** Authorization, authentication, input validation, output encoding, secrets handling, sensitive data exposure, trust boundaries.
3. **Data integrity:** Validation, transactions, consistency, duplicate submissions, retries, migration safety.
4. **Compatibility:** API contracts, existing consumers, schema compatibility, configuration, supported environments.
5. **Reliability and performance:** Failure handling, timeouts, resource use, unnecessary queries, scalability.
6. **Maintainability:** Duplication, complexity, naming, conventions, unnecessary scope.
7. **Tests:** Coverage of changed behavior and important edge cases.
8. **Documentation:** User-facing or developer documentation needs.

### Graphify / Obsidian review checks

- No generated graph artifacts were hand-edited.
- No secrets, credentials, tokens, keys, connection strings, or customer PII were written to vault notes or reports.
- Graphify and Obsidian were used only as navigators; findings were verified in source and `AGENTS.md`.
- `Graphify-Export/` was not bulk-read or summarized.

### Rules

- Inspect the actual diff and relevant surrounding code.
- Base findings on evidence. Reference file paths and line numbers when available.
- Do not report speculative issues as confirmed defects.
- Do not flag style preferences as bugs unless they violate project conventions or materially reduce maintainability.
- Prioritize actionable findings by severity: Critical, High, Medium, Low.
- Explain impact and concrete remediation for each finding.
- Do not edit files, run destructive commands, or claim tests were run unless they were run.
- If no findings are identified, state that this is not proof the code is defect-free and list important areas not verified.

### Report format

1. Findings ordered by severity, with evidence and remediation.
2. Missing tests or coverage gaps.
3. Checks performed and their results.
4. Areas not reviewed or unable to verify.
5. Overall recommendation: approve, approve with follow-up, or request changes, with reason.

If a finding is only a possibility, label it as a question or risk rather than a confirmed defect.

## Security review

### Recommended agent/mode

Use Plan mode or a verified read-only reviewer. Do not run exploitative or destructive tests against live systems.

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