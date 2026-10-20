# CODE REVIEW — Review Changes Without Editing Them

## Recommended agent/mode
Use a separately configured **read-only reviewer subagent** if available. Otherwise use a read-only/Plan mode and verify that edit permissions are restricted.

## Review target

[Describe the task, branch, diff, or files to review.]

## Prompt

Review the implementation as an independent code reviewer. Do not modify any files.

### Review priorities

1. **Correctness:** Does the code meet the approved requirements? Are there logic errors, missing cases, race conditions, or incorrect assumptions?
2. **Security and privacy:** Check relevant authorization, authentication, input validation, output encoding, secrets handling, sensitive data exposure, and trust boundaries.
3. **Data integrity:** Check validation, transactions, consistency, duplicate submissions, retries, and migration safety where applicable.
4. **Compatibility:** Check API contracts, existing consumers, schema compatibility, configuration, and supported environments.
5. **Reliability and performance:** Check failure handling, timeouts, resource use, unnecessary queries, and scalability concerns where relevant.
6. **Maintainability:** Check duplication, complexity, naming, conventions, and unnecessary scope.
7. **Tests:** Check whether tests cover the changed behavior and important edge cases.
8. **Documentation:** Check whether user-facing or developer documentation needs updating.

### Rules

- Inspect the actual diff and relevant surrounding code.
- Base findings on evidence. Reference file paths and line numbers when available.
- Do not report speculative issues as confirmed defects.
- Do not flag style preferences as bugs unless they violate project conventions or materially reduce maintainability.
- Prioritize actionable findings by severity: Critical, High, Medium, Low.
- Explain the impact and a concrete remediation for each finding.
- Do not edit files, run destructive commands, or claim tests were run unless they were run.
- If no findings are identified, state that this is not proof that the code is defect-free and list important areas not verified.

### Report format

1. Findings, ordered by severity, each with evidence and remediation.
2. Missing tests or coverage gaps.
3. Checks performed and their results.
4. Areas not reviewed or unable to verify.
5. Overall recommendation: approve, approve with follow-up, or request changes, with a brief reason.

If a finding is only a possibility, label it as a question or risk rather than a confirmed defect.
