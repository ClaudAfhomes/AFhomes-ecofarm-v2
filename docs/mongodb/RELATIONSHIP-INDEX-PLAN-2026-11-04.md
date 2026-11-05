# Referral relationship index plan - 4 November 2026

Status: **proposal - not installed in Atlas.** Phase 9 (5 Nov): both entries added to the guarded
plan (`MONGO_PERFORMANCE_INDEXES`, now 19 entries) and the indexed traversal implemented locally
behind an index-presence gate (see "Phase 9 implementation"). Until the indexes exist, the code
takes exactly the Phase 8 path. Measured on disposable replicas only; no Atlas change.

## Proposed indexes (`referral_relationships`)

| Name | Key | Options | Serves |
| --- | --- | --- | --- |
| `read_relationship_subject_upline` | `{ subject_staff_id: 1, upline_staff_id: 1 }` | none | Every edge of a member in the genealogy walk order (subject, then upline); also removes the in-memory SORT from today's full ordered edge read |
| `read_relationship_upline_subject` | `{ upline_staff_id: 1, subject_staff_id: 1 }` | none | Downward traversal (who reports to these members) |

Today only `{ subject_staff_id: 1 }` exists, unique and **partial** on `is_active: true`, so it
cannot serve reads that must include retired edges (the display-parent walk falls back to a
member's first stored edge, which may be retired). Both new indexes are additive and non-unique;
the partial unique index keeps enforcing one active upline.

## Evidence (all results identical to the current all-edges read)

Synthetic hierarchy 10 VD x 6 SSM x 8 SM x N OST, 10% retired edges, 200 cross-branch transfers,
a 5,000-wide SM; callers VD, SM, OST, wide SM and a deep member. "Indexed traversal" = walk the
caller's chain up, then expand downward level by level, reading only edges of in-scope members.

| Dataset | All edges (current) | Indexed traversal (with indexes) | Data transferred |
| --- | --- | --- | --- |
| ~15k members, normal depth | 95-117 ms | 68-75 ms (14-19 queries) | 2.3 MB -> 1.4 MB |
| ~55k members, normal depth | 332-356 ms | 124-134 ms (14-21 queries) | 8.4 MB -> 2.8 MB |
| ~15k with a 300-level inactive chain | 86-96 ms | 196-419 ms (~600 queries) | 2.4 -> 1.6 MB |
| ~55k with a 300-level inactive chain | 347-373 ms | 255-469 ms (~600 queries) | 8.5 -> 3.0 MB |
| Without the indexes (any shape) | - | 3.8-12 s (collection scan per step) | - |

Full ordered edge read with the subject/upline index: 94 -> 72 ms (~15k), 342 -> 309 ms (~55k).

## Phase 9 implementation (local; `api/_lib/genealogy.mongo.ts`)

- **Gate.** `findRelationshipTraversalIndexes` (`performance-indexes.mongo.ts`) returns the two
  index names only when both exist with exactly the planned keys and are usable: not partial,
  sparse, hidden, collated or TTL, on a collection without a default collation. A cached result
  (at most 60 s, discarded after any failed traversal) only decides whether to attempt the
  traversal. Each traversal re-runs the check in parallel, and its result is discarded unless the
  same two usable indexes are confirmed again. This covers, for example, an index replaced by a
  partial one under the same name.
- **Hints.** Every traversal query names its index (`hint`). If an index is dropped after the check,
  the query fails at once instead of scanning, and the request falls back. The traversal therefore
  never runs a relationship lookup without its index.
- **Limits.** At most 32 walk steps up, 32 levels down, 64 queries and 100,000 members in scope;
  `$in` lists of at most 20,000 ids. Any limit reached -> the Phase 8 all-edges read answers.
- **Exactness.** The same walk-edge rule (first active edge, else first stored edge in
  subject/upline order; empty uplines end a walk) and the same scope. Only in-scope members' edges
  are passed on; the genealogy model reads edges only through those members' walks. Edges that
  are not read are checked in MongoDB by a validity probe with the `RELATIONSHIPS` schema rules, so
  any invalid edge anywhere still produces the same 400 through the full read.
- **Inactive, retired, transferred and nearest-active-ancestor rules** are unchanged: the model
  code (`genealogy-model.ts`) is not modified, and it receives identical inputs for every member
  it projects.
- **Parity evidence.** The handler fuzz compares Phase 9 with the Phase 8 snapshot on random
  disposable worlds in four modes: no indexes, both indexes, a partial index under the planned name,
  and an index dropped after the gate confirmed it. The worlds include retired and transferred edges,
  cycles, self loops, duplicate pairs, empty uplines, ghost members, several active edges per
  member, deep chains beyond the limits, and invalid staff and edge rows. Result: 19,200 requests,
  0 differences. There were 0 hinted queries without both indexes confirmed, and 0 unhinted filtered
  edge queries. The traversal completed about 2,700 times; its fallbacks were the intended cases.
  Planted-bug results are in the Phase 9 report.

## Requirements before the code path is enabled (Phase 9 status)

1. Indexes present, never assumed: **met** by the gate plus per-query hints (above).
2. A level cap that falls back to the all-edges read for pathological inactive chains: **met**
   (32 steps or levels, 64 queries).
3. Same validity probes and size guards as the scoped read, plus parity fuzz: **met** (an edge
   probe was added because unread edges are no longer parsed; fuzz above).

## Final guarded installation plan (separate approval required; nothing executed)

Approval scope requested: create **only** these two indexes on Atlas `afhomes_dev`, with no other
index, validator or document change.

1. **Read-only plan.** `cd api && npx tsx scripts/prepare-mongodb-performance.ts --plan` (loads
   `.env.local` through the app's loader; prints nothing secret). Expected: the 17 installed entries
   `present`, and `read_relationship_subject_upline` and `read_relationship_upline_subject`
   `missing`. No `index-name-conflict`, `index-option-conflict` or `collection-collation-review`.
   Record the printed digest. The digest covers the current Atlas state, so it is known only at
   approval time.
2. **Read-only checks.** `referral_relationships` document count and existing indexes. Expected:
   `_id` and the partial unique `{ subject_staff_id: 1 }` (active edges) only. Record the Atlas
   index count at this moment and use it as the baseline, not a number from an earlier phase.
   The running app creates collections implicitly on first write, each with its `_id_` index.
3. **Apply (the approved action).** `npx tsx scripts/prepare-mongodb-performance.ts --apply
   --approve-indexes=afhomes_dev --approve-plan=<digest from step 1>`. The installer refuses any
   other database, a changed digest, or any conflict. Both builds are non-blocking and additive; the
   collection holds one edge per member assignment, so the build takes seconds.
4. **Verify (read-only).** Definitions exactly as planned (non-unique, not partial). Index count
   is the step-2 baseline +2. Plan re-run shows all 19 `present`. Explain plans show `IXSCAN` on
   `read_relationship_subject_upline` for `{ subject_staff_id: { $in } }` and on
   `read_relationship_upline_subject` for `{ upline_staff_id: { $in } }`. Document counts unchanged.
5. **Activation.** No deploy or setting is needed. A running API confirms the indexes within 60 s
   and seller genealogy requests then use the traversal. Spot-check one VD, SM and OST genealogy
   against the response before the apply (same JSON).
6. **Rollback (separate approval).** Drop the two indexes by name. Requests whose gate result is
   still cached fail their first hinted query and fall back immediately. Within 60 s every request
   takes the Phase 8 path again. No data is affected either way.

## Phase 10 validation (5 November; nothing installed)

- **Disposable dry run of the full procedure** (`afhomes_dev`-named loopback replica with core
  setup and the 17 earlier entries present): 24/24 checks passed.
  - Plan: exactly the two entries `missing`, no conflict. Stale digest and non-`afhomes_dev`
    database both refused.
  - Apply: added only the two indexes. Exact definitions, `IXSCAN` on both lookups, index count
    +2, document counts unchanged, all 19 `present` afterwards.
  - Genealogy (VD, SM, OST; list, summary, ost-contacts): identical before, after the apply (with
    the traversal in use) and after rollback. Handlers created before the apply and before the
    rollback also answered identically.
  - Rollback restored the index count. A planted name conflict was detected, the apply refused,
    and the conflicting index left untouched.
- **Atlas `afhomes_dev`, read-only only** (the plan's steps 1-2; no write of any kind):
  - `--plan`: 19 entries, 17 `present`, exactly `read_relationship_subject_upline` and
    `read_relationship_upline_subject` `missing`, no conflict or collation-review status. Digest
    `d0ea32a7…` is valid only while the Atlas state is unchanged; re-run step 1 at approval.
  - `referral_relationships`: 4 documents, no default collation, indexes `_id_` and
    `subject_staff_id_1` (unique, partial) only. The build is trivial at this size.
  - Atlas totals: 69 collections and 184 indexes, against 68 and 183 recorded after Phase 8. Every
    non-`_id_` index maps to an approved setup or plan entry. The difference is one collection the
    running app created implicitly on first write, with its mandatory `_id_` index; the Phase 8
    record kept only totals, so that collection cannot be named.
- Ready for a separate final confirmation. Installation remains not approved.
