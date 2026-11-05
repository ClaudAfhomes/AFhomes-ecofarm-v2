---
name: afhomes-business-rules
description: Find and apply the authoritative AF Homes business rule before changing rule-sensitive behavior (IDs, accreditation, genealogy, pricing, payments, commissions, points, module availability). Use to verify a rule, resolve a doc/code conflict, or before any business-logic edit.
---

# AF Homes business-rule verification

## Applies when
Any change or question touching business behavior, or a request that states a rule as fact.

## Procedure
1. Find the rule in `docs/ai/business-rules-index.md` (module → document map).
2. Open only that section (`rg -n "^#" <doc>` then read the range).
3. Check status: `docs/business-rules/INDEX.md` says **no rule is APPROVED** there; check
   `CONFLICTS.md` / `OPEN_QUESTIONS.md`. `docs/AFHOMES-BUSINESS-RULES.md` marks `[APPROVED FORMAT]`,
   `[SOURCE]`, `[V2 PROPOSAL]`, `[OPEN DECISION]`.
4. Owner instructions recorded in `AGENTS.md` (dated) and `docs/mongodb/*` override older docs.
5. Compare with the code (the test that pins it). If they disagree → record in
   `docs/ai/decision-register.md` as Unresolved and ask; never pick one silently.
6. Then load the domain skill.

## Safety
- Summaries (including this repo's skills) are navigation, not policy. Implement from the source text.
- Never invent prices, rates, tiers, thresholds, policy versions or qualification rules.
  No final-commission-qualification rule exists — `earned` is a manual, gated, audited decision.
- Never "fix" historical records to match a newer rule.

## Done when
You can cite the governing document + section + status, and the code/test location.
