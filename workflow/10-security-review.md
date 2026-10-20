# SECURITY REVIEW — Assess a Defined Scope

## Recommended agent/mode
Use **Plan** mode or a verified read-only reviewer. Do not run exploitative or destructive tests against live systems.

## Scope

[Describe the feature, endpoints, auth flow, input fields, file handling, or other security-sensitive area.]

## Prompt

Perform a defensive security review of the specified code and its relevant data flow.

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
