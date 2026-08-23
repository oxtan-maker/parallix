# Mission: Batch SQLite review projections for the board (task-2401)

## Goal
Make `BoardProjectionBuilder.build()` request review facts once for the complete mission set. On the production SQLite path, hydrate those facts from a fixed set of batch queries instead of calling `SqliteMissionStore.load()` twice per mission. Preserve every review value and command decision currently projected onto `MissionCard`, especially approval of the same reviewed revision.

## Why Now
The board rebuilds repeatedly, but its current `ConcreteReviewReadAdapter` calls `SqliteMissionStore.load()` separately for `loadReview()` and `loadReviewApproval()` for each mission. That checked aggregate load intentionally hydrates much more than the board needs and is serialized for consistency. With N missions, the board can therefore perform approximately 2N complete aggregate loads just to render review state. A dedicated read shape removes that avoidable polling cost without weakening the domain write path.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: board refresh cost, duplicate checked-aggregate hydration, review-history fidelity, deterministic query-count regression coverage

## Scope
- Replace the board review port's pair of per-mission reads with one batch operation over the mission IDs loaded for the build. Its result must contain each mission's `Review | null` and approval fact, keyed by mission ID.
- Add a dedicated SQLite review projection reader. For mission sets within one SQLite bind batch, it must issue one query each for `mission_review_rounds`, `mission_review_findings`, `mission_review_resolutions`, and `mission_review_events`, then group and hydrate in memory. Approval must be derived from the hydrated current round, not queried or reconstructed separately.
- Reuse the existing persisted-review row shapes and validation/hydration rules. Extract only the smallest shared review hydrator needed; do not duplicate the domain interpretation in the board or composition layer.
- Wire the SQLite reader through the production composition graph. `BoardProjectionBuilder` must call the batch operation before card mapping and must not use `MissionStore.load()` for review or approval facts.
- Preserve the board-visible contract: current round number and phase, disposition, reviewed change and revision, approval timestamp and revision, pull-request or local-branch reference, reviewer, implementer, round history, findings, resolutions, review events, approval owed, and integration-command eligibility based on approval of the same reviewed revision.
- Keep the existing flat `ReviewState` fallback inside the concrete adapter when no SQLite projection reader is available. Missing review state must still produce `null` review and approval facts.
- Add a focused SQLite test that counts only calls made through the review projection reader's injected `SqliteDatabaseAdapter`. Compare one mission with a populated set and assert exactly four review SQL queries in both cases.

## Out of Scope
- Changing `SqliteMissionStore.load()`, its full aggregate hydration, its operation queue, or its consistency guarantees.
- Storing copied review state in a new durable projection table or introducing a second review authority.
- Generic caching, prepared-statement caching, SQLite PRAGMA tuning, worker-thread migration, or broad performance instrumentation.
- Changes to TASK-2400 filesystem/worktree behavior, TASK-2402 status targeting, running-agent detection, gate projections, or metrics projections.
- Altering command/domain paths that need a checked Mission aggregate, including review lifecycle writes and integration authority.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `test/board-readers.test.ts` contains the test `BoardProjectionBuilder preserves populated multi-round review cards from a batch projection`. Its board includes no-review, in-progress, changes-requested-with-response, and approved pull-request cases and asserts current round, phase, disposition, reviewed subject/revision, reviewer, implementer, history findings/fixes/pushbacks, PR/local-change reference, approval owed, and approval state. Falsified if any asserted card value differs from the pre-change projection semantics.
- SC2: For an approved round, the review projection returns approval only for that round's reviewed subject and revision; the board enables integration only when the approval and displayed review refer to the same revision. Falsified if an approval for a different revision enables integration.
- SC3: `test/task-2401-review-projection-queries.test.ts` contains the test `SQLite review projection uses four queries for one or many missions`. With both one mission and a populated mission set inside one bind batch, the counting database seam observes exactly four projection queries. Falsified if either count differs from four or grows with mission count.
- SC4: `test/task-2401-review-projection-queries.test.ts` contains the test `SQLite-backed board review projection never loads Mission aggregates`. A production-shaped board build fails if its `MissionStore.load()` spy is called for review or approval facts and passes while returning populated review cards through the batch reader.
- SC5: `SqliteMissionStore.load()` remains the checked full-aggregate read for domain/command callers and retains its serialized aggregate-operation queue. Falsified if the implementation bypasses, partially hydrates, or relaxes that store.
- SC6: `test/adapters/concrete-adapters-cp2.test.ts` contains the test `ConcreteReviewReadAdapter batch fallback preserves flat and missing review state`. Falsified if the no-SQLite path throws, omits the existing flat state, or fabricates approval for a missing/unapproved review.
- SC7: `./scripts/verify-local.sh all` completes successfully on the final tree.

## Risks and Assumptions
- The board reads rounds, decisions, responses, findings, resolutions, and review events. Stage-launch windows and aggregate intervention state are not consumed by `MissionCard`, so this projection does not query them. If card projection begins consuming either during execution, stop and add the corresponding existing relation to the fixed query set and update the exact count in SC3.
- SQLite bind-variable limits constrain a single `IN (...)` batch. Assumption: normal board mission sets fit the supported bind limit; the implementation must make the bound explicit and use safe chunking only if the adapter's supported mission set can exceed it.
- Approval is derived from the current approved round and must retain the exact `ReviewedRevision` used by `sameReviewedRevision`; independently reconstructing a different value would incorrectly enable integration.
- The production adapter currently has a flat-state fallback. Assumption: preserving that fallback is necessary for test doubles and bootstrapping, but composition supplies the SQLite projection reader for normal production board builds.

## Checkpoints
- CP 1: Add the batch review-port characterization in `test/board-readers.test.ts`, including the exact populated multi-round card test from SC1 and same-reviewed-revision integration eligibility from SC2.
- CP 2: Add `test/task-2401-review-projection-queries.test.ts` with the exact SC3 query-count test and SC4 aggregate-load guard. Count `SqliteDatabaseAdapter.query()` calls at the reader boundary so unrelated board reads cannot affect the assertion.
- CP 3: Implement the SQLite reader over the four existing review relations and the minimal shared review hydrator; prove absent and populated multi-round hydration without changing schema or aggregate-store behavior.
- CP 4: Replace the board's per-mission review/approval calls with one batch call, wire the production SQLite reader, and retain the flat-state fallback test named in SC6.
- CP 5: Run focused tests during implementation, then run `./scripts/verify-local.sh all` once on the final tree and record complete SC1-SC7 evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited markdown table with exactly `| Criterion | Evidence | Status |` as its header.
- At least one evidence row for every success criterion, led by durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `` `npm test -- test/board-readers.test.ts` ``, `` `node --test test/board-readers.test.ts` ``, `` `git diff --check` ``, `` `px status` ``, or `` `./scripts/verify-local.sh all` ``. File:line references are accepted parenthetically when necessary but discouraged because line numbers rot.
- Explicit query-count evidence for SC3: the test path, its exact test name, and the command that runs it.
- **Weak-agent failure mode:** raw `stat`/`ls` output or generic prose alone is not enough. Pair any shell output with an accepted reference above; a checkpoint that only pastes shell output or says that work passed will be rejected.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Board review semantics preserved | `test/board-readers.test.ts`, `BoardProjectionBuilder preserves populated multi-round review cards from a batch projection` | PASS |
| Query count remains bounded | `test/task-2401-review-projection-queries.test.ts`, `SQLite review projection uses four queries for one or many missions`, `npm test -- test/task-2401-review-projection-queries.test.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/adapters/sqlite/mission-store.ts`: do not change `SqliteMissionStore.load()`, full aggregate hydration, or the aggregate-operation queue. Shared review hydration may be extracted from `mission-serialization.ts`; do not route the projection through `load()`.
- SQLite schema and migrations: do not add a copied review projection table or alter durable review authority for this performance change.
- `src/domain/` review invariants and integration approval policy: preserve them; the read model must reflect, not reinterpret, domain state.
- `src/adapters/cli/commands/integrate.ts`: do not weaken same-reviewed-revision approval eligibility.
- Filesystem review-state reads: retain only the existing fallback behavior; do not make them the production substitute for the SQLite batch path.
