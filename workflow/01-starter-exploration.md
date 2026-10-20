# STARTER / EXPLORATION — Familiarize Yourself With the Codebase

## Recommended agent/mode
Use the available **Plan** agent/mode or another read-only agent.

## Prompt

I want you to familiarize yourself with this codebase before we implement any feature.

### Phase 1: Discovery

- Identify the technology stack, frameworks, runtime, package manager, and major dependencies. Cite the files or command output that support your findings.
- Explain the project folder structure, focusing on important folders and entry points.
- Trace the main application flows, including routing, authentication, API communication, database access, authorization, background jobs, and external integrations where applicable.
- Identify important architectural patterns and existing coding conventions.
- Locate the tests, test framework, linting, formatting, type-checking, and build scripts. Explain how to run the relevant checks based on the repository's actual scripts.
- Read applicable `AGENTS.md`, README, and other project instructions.

### Phase 2: Understanding

- Explain how the frontend, backend, database, and external services interact, if applicable.
- Identify important shared components, services, hooks, middleware, utilities, models, schemas, and configuration.
- Identify potential risks, technical debt, duplicated logic, fragile areas, or unclear behavior. Include evidence and file paths.
- Distinguish current behavior from inferred intent.
- Do not infer that a feature exists merely because a dependency is installed.

### Phase 3: Report

Provide:
1. A concise codebase overview.
2. Technology stack and key dependencies.
3. Architecture and major request/data flows.
4. Important file paths and what each is responsible for.
5. Existing test and verification commands.
6. Risks, technical debt, and unclear areas, with evidence.
7. Questions that need clarification before future implementation.

### Rules

- Do not modify project files.
- Do not install or update dependencies.
- Do not run destructive commands, migrations, deployment commands, or commands that alter shared systems.
- Do not expose secrets from environment files, credentials, tokens, private keys, or connection strings. If needed, report only variable names and whether a variable appears to be configured.
- Prefer read-only inspection. Do not run arbitrary application scripts unless they are known to be safe and necessary.
- Base findings on actual files and code, not assumptions.
- If something cannot be verified, explicitly say so.
- Report any command you could not run and why.

Stop after presenting the report. Wait for my next instruction before planning or implementing anything.

### Repository / focus (optional)

[Specify a folder, subsystem, or context if you want to narrow the exploration.]
