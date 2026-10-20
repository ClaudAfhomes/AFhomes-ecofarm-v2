# RELEASE READINESS — Assess Before Release or Deployment

## Recommended agent/mode
Use **Plan** mode or a read-only reviewer for assessment. Use **Build** only for approved fixes.

## Release / change

[Describe the version, feature, branch, or release candidate.]

## Prompt

Assess whether this change appears ready for release based on repository evidence. Do not deploy or modify files.

### Review

- Confirm the intended scope and inspect the Git status and diff.
- Identify relevant tests and verification commands from the actual project setup.
- Review test results available in the current context; run safe checks only when appropriate and authorized.
- Check configuration and environment-variable changes without revealing secret values.
- Consider database migration safety, rollback options, data integrity, API compatibility, and background jobs where applicable.
- Check logging, monitoring, error handling, and operational documentation where applicable.
- Identify required manual checks, external dependencies, credentials, approvals, or environment-specific validation.
- Look for accidental files, debug code, secrets, unrelated changes, and missing documentation.
- Identify unresolved high-impact risks.

### Rules

- Do not commit, push, deploy, migrate production data, or change shared systems.
- Do not infer release procedures that are not documented.
- Do not claim tests passed unless they actually ran.
- Separate verified facts, assumptions, and checks that remain blocked.
- If rollback or migration safety cannot be established, clearly state that limitation.

### Report

Provide:
1. Readiness recommendation: ready for human release decision, not ready, or unable to determine.
2. Evidence supporting the recommendation.
3. Verification checklist with passed, failed, blocked, and not-run statuses.
4. Blocking issues and non-blocking follow-ups.
5. Migration, compatibility, security, and rollback risks.
6. Manual steps and approvals still required.

This assessment is not authorization to release or deploy.
