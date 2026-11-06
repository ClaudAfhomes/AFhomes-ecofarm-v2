# Approved genealogy index installation — 5 November 2026

**Applied and verified in Atlas `afhomes_dev`.** The owner authorized installing the two reviewed indexes after checking that they preserve functionality and do not introduce an unacceptable performance cost. No further index, document, validator, credential, account, deployment or service change was authorized or performed.

## Exact scope

| Collection | Index | Ordered key | Options |
| --- | --- | --- | --- |
| `referral_relationships` | `read_relationship_subject_upline` | `{ subject_staff_id: 1, upline_staff_id: 1 }` | Non-unique, full collection, not sparse/hidden/TTL/collated |
| `referral_relationships` | `read_relationship_upline_subject` | `{ upline_staff_id: 1, subject_staff_id: 1 }` | Non-unique, full collection, not sparse/hidden/TTL/collated |

The existing partial unique active-subject constraint remains unchanged. These indexes neither change relationship selection rules nor rewrite data. They add storage and index maintenance on relationship writes; zero overhead is not claimed. The collection had four documents at installation, so this was a small build.

## Verification and result

- Fresh disposable replica: **19 checks passed** for the exact pending set, wrong database/stale digest refusal, additive creation, definitions, both hinted IXSCAN plans, unchanged documents, rollback and planted conflict refusal. No tests targeted Atlas.
- Fresh Atlas read-only preflight: 19 planned entries, 17 present, exactly the approved two missing, no conflict. Both example lookups initially examined four documents without an index scan.
- Baseline recorded at **16:13:17 Singapore time**; after-verification completed at **16:14:53**.
- The existing digest-bound CLI returned exactly the two approved names in `added`, with no deferred entry. Its fresh-state digest check prevented applying a different plan.

| Check | Before | After |
| --- | --- | --- |
| Collections | 69 | 69 |
| Total indexes across collections | 184 | 186 |
| Relationship documents | 4 | 4 |
| Relationship document fingerprint | Recorded locally | Identical |
| Existing index definitions, all collections | Recorded locally | Identical after excluding the two additions |
| Reviewed plan entries present | 17 / 19 | 19 / 19 |
| Subject lookup | 4 documents examined, no index scan | Hinted IXSCAN; 1 document, 1 key examined |
| Upline lookup | 4 documents examined, no index scan | Hinted IXSCAN; 1 document, 1 key examined |

Approved pre-apply digest: `d0ea32a7497ca1bdd7dac138c4684a6b4d58f659a3f11d5f58bdd5d5338d14c2`.
Verified post-apply digest: `96ce06c62ef2af557ee33b00653e1df684f552ca0a3e81c6e9bb2e2d8a2415f4`.
Digests describe those observations, not standing permission for a future apply.

## Execution and limits

Used the existing `api/scripts/prepare-mongodb-performance.ts --apply --approve-indexes=afhomes_dev --approve-plan=<fresh approved digest>` installer. The preflight and independent after-check read collection/index metadata and relationship records only; no authentication session or business write was used. Metadata/fingerprints and sanitized command results remain in ignored `.git/relationship-index-*-2026-11-05.json` and `.git/relationship-approved-*.log`. No raw records or credentials are included here.

Code containing the Phase 9 index-presence gate can now detect both indexes. The running DigitalOcean revision was not inspected or updated; activation of that traversal on the deployed release is not verified. Hinted query plans establish availability, not a live latency or throughput guarantee. At four documents, a noticeable user-facing speed increase is not established.

U12's index-installation gate is closed. The other [Phase 10 blockers](PHASE-10-RELEASE-READINESS-2026-11-05.md) remain. No rollback was needed; dropping either index would require a separately approved action. No commit, push, deployment, restart or credential rotation was performed in this installation task.
