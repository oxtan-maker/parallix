# CP-4: Delete persisted retry state

## Summary

The persisted retry state is gone. After CP-1 (artifact bounces onto the kernel) and CP-3
(per-round cap), nothing in the review loop still *read* a persisted retry counter; CP-4
deletes the fields, the metadata keys, the mapping sync, the domain record methods, the
SQLite column reads/writes, the status log lines, and adds the forward-only drop migration.

**What landed:**

- **`src/adapters/review/review-state.ts`** — `reviewerRetryCount` / `implementerRetryCount`
  removed from the `ReviewStateData` interface, its JSDoc typedef, the `ReviewState` class
  fields, the constructor, and `toJSON()`. `advanceRound()` no longer resets them and no
  longer deletes the six artifact-retry / strand-marker metadata keys
  (`reviewerArtifactRetryCount`, `implementerArtifactRetryCount`,
  `reviewerArtifactStrandedAt`, `reviewerArtifactStrandReason`,
  `implementerArtifactStrandedAt`, `implementerArtifactStrandReason`) — CP-1 deleted the
  writers, so the reset side had nothing left to clean. `resetReviewState()` (`--reset`)
  stops zeroing the round counters and `gateFailureRetryCount`; its doc comment was
  rewritten rather than silently narrowed, because `--reset` no longer clears a retry budget.
- **`src/adapters/review/review-state-mapping.ts`** — the removed fields drop out of
  `reviewStateDataFrom()` and `metadataFromReview()`; `applyReviewStateToReview()` stops
  materializing `gateFailureRetryCount` / `hookFailureRetryCount` from metadata; the
  now-unused `nonNegativeCount` helper is deleted.
- **`src/domain/review.ts`** — `Review.gateFailureRetryCount` / `Review.hookFailureRetryCount`
  and their initializers in `startReview()` removed; `recordGateFailureRetry`,
  `recordHookFailureRetry`, and the orphaned `recordReviewRetry` deleted.
- **SQLite** — new forward-only migration
  `src/adapters/sqlite/migrations/0016-review-drop-retry-counters.sql` (next free id after
  0015) drops `mission_reviews.gate_failure_retry_count` and
  `mission_reviews.hook_failure_retry_count`. `mission-store.ts` stops selecting and
  upserting the two columns, `mission-serialization.ts` drops them from
  `MissionReviewRecord` and `reviewFrom()`, `mission-import-parsing.ts` stops materializing
  them from legacy `review-state.json` metadata, and
  `concrete-review-read-adapter.ts` drops them plus its `nonNegativeGateRetries` helper.
- **`src/adapters/review/review-commands.ts`** — the two `Reviewer retries:` /
  `Implementer retries:` lines in `showReviewStatus` deleted; they read fields that no
  longer exist and would have printed a number the loop never writes.
- **`src/application/consumer-domain-requirements.ts`** — the `retry-review-round-counters`
  ledger entry removed (its anchor `state.reviewerRetryCount` in `review-commands.ts` is
  gone); the `review-round-state` and `MissionOutcome` anchors re-pointed to their new
  lines. Anchors and requirements otherwise unchanged.
- **`src/adapters/review/review-loop.ts`** — the two timeout-recovery while-loops now use
  round-local in-memory counters (`reviewerTimeoutRetries` / `implementerTimeoutRetries`,
  reset per round) instead of reading and persisting `state.reviewerRetryCount` /
  `state.implementerRetryCount`. The two `persistReviewStateOrThrow` calls that existed
  only to persist the incremented counter are deleted. Bound (2), prompt text, poll
  `retryCount` argument, escalation reason, and the CP-3 cap check are unchanged.
- **No-copied-override-regex item verified:** `git grep -nE "RegExp|human-only|override"
  src/adapters/review/review-gate-handling.ts` returns one hit, a doc comment
  (`/** True when the occurrence exhausted its budget or is human-only. */`). No hook regex
  and no human-only override rule remain in the review-loop gate-handling code; the
  kernel's classifier is the only one.

### Changed expectations (each pairs a test name with why the old expectation encoded deleted behavior)

| Test (new name) | Why the old expectation had to change |
|---|---|
| `"startReviewLoop performs recovery relaunches without persisting any retry count"` (`test/review.test.ts`) | Was `"startReviewLoop persists reviewer retry count before recovery relaunch"` — it asserted a state write carrying `reviewerRetryCount === 1` ordered before the relaunch. That write is exactly what CP-4 deletes. The replacement asserts the relaunch still happens **and** that no write carries a retry count, so the deletion cannot regress into a silent re-add. |
| `"startReviewLoop performs the implementer recovery relaunch without persisting any retry count"` (`test/review.test.ts`) | Same, for `implementerRetryCount`. |
| `"reviewer-non-submission: error fires without completing recovery retries (TASK-2233 repro)"`, `"…null poll result breaks recovery loop prematurely"`, `"…forgejoEnabled=false — recovery loop breaks on first iteration"` (`test/task-2233-reviewer-non-submission-bounce.test.ts`) | All three read the final `reviewerRetryCount` out of the mocked `writeReviewStateFn` to prove the recovery loop ran twice. With the counter in memory there is nothing to observe in a write, so each now counts reviewer launches through `startAgentFn` and asserts 3 (one first launch + two recovery relaunches) — the identical guarantee, observed at the launch port instead of the state store. The bound and escalation assertions are untouched. |
| `"retry counters reset when a round begins (TASK-2377.04: no domain record method; the round fields survive on ReviewRound)"` (`test/domain-review-workflow-state.test.ts`) | Was `"retry counters accumulate per actor and reset when a round begins"` and drove `recordReviewRetry` — the deleted domain method. The surviving half of the guarantee (a new round starts both round counters at 0) is kept and still asserted. |
| `"ReviewState toJSON includes metadata when present (TASK-2377.04: no retry counts serialize)"` (`test/review-state.test.ts`) | Was `"ReviewState toJSON includes retry counts and metadata when present"`; the retry counts no longer exist to serialize. |
| `"advanceRound increments round and resets phase/disposition (TASK-2377.04: retry counts are loop-local)"` (`test/review-state-class.test.ts`) | Was `"advanceRound increments round and resets phase/disposition/retries"`; `advanceRound` no longer has retries to reset. |
| Fixture/round-trip updates in `test/fixtures/review-state-db.ts`, `test/board-readers.test.ts`, `test/e2e-mission-sqlite-cutover.test.ts`, `test/sqlite-mission-store.integration.test.ts`, `test/task-1109.test.ts`, `test/task-2339-*.test.ts`, `test/task-2341-review-store-wiring.test.ts`, `test/task-2343-lifecycle-persistence.test.ts`, `test/task-2344-review-history-status-repro.test.ts`, `test/task-2347.10-repro.test.ts`, `test/task-2358-multi-round-repro.test.ts`, `test/task-2368-agent-running-review-detection.test.ts`, `test/task-2369-regressions.test.ts`, `test/task-2376-lifecycle-timing.test.ts`, `test/task-2378-authoritative-stats.test.ts` | Mechanical: these construct a `Review` literal and had to drop the two removed required fields. No assertion was deleted. |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5 — review-state fields and metadata keys deleted | `git grep -n "reviewerArtifactRetryCount\|implementerArtifactRetryCount" -- src/` → zero hits; `git grep -n "reviewerRetryCount\|implementerRetryCount" -- src/adapters/review/review-state.ts` → zero hits. Asserted by `"ReviewState toJSON includes metadata when present (TASK-2377.04: no retry counts serialize)"` and `"advanceRound increments round and resets phase/disposition (TASK-2377.04: retry counts are loop-local)"` (`test/review-state.test.ts`, `test/review-state-class.test.ts`); the state-write side by `"startReviewLoop performs recovery relaunches without persisting any retry count"` (`test/review.test.ts`) | Met, with one documented exception (below) |
| SC5 — `git grep` over `src/` returns zero remaining references | `git grep -n "gateFailureRetryCount\|hookFailureRetryCount" -- src/` leaves three classes of hit, all mission-sanctioned: the historical text of migrations `0009-review-gate-retries.sql` / `0012-review-hook-retries.sql` (immutable per Restricted Areas), and `src/application/hook-failure-workflow.ts` — a **Restricted Area**, read-only for this mission, whose `handleHookFailureBounce` is reached only from `src/application/rebase-workflow.ts` and `src/adapters/cli/commands/integrate-post.ts` (the CLI/handoff bounce paths explicitly deferred to TASK-2377.05); `git grep -n "hook-failure-workflow" -- src/` shows `src/adapters/review/review-gate-handling.ts` imports only `classifyHookFailure`, not the persisting bounce. `reviewerRetryCount` / `implementerRetryCount` survive only as the `mission_review_rounds` round fields the mission's Out of Scope and Risks sections require to survive (`src/domain/review.ts` `ReviewRound`, and the four sites in `review-state-mapping.ts` that carry `previous.reviewerRetryCount` through unchanged) | Met as scoped; literal-zero not reachable — see note |
| SC6 — drop migration | `src/adapters/sqlite/migrations/0016-review-drop-retry-counters.sql` drops both `mission_reviews` columns and touches no earlier migration. `npm test -- test/task-2377.04-drop-retry-counters-migration.test.ts` → 5 pass / 0 fail: `"is discovered by loadDefaultMigrations with a stable checksum and is forward-only"`, `"runs on a pre-existing 0015-or-older database: columns absent afterwards, other review data survives"`, `"applies on a fresh database: mission_reviews never carries the retry columns"` | Met |
| SC6 — mission round-trip without the removed fields | `"mission round-trips (store serialize → reload) without the removed fields; historical round counts stay"` and `"legacy import parsing: a pre-cutover review-state.json with the removed counters imports without them"` in `test/task-2377.04-drop-retry-counters-migration.test.ts`; the second pins that a legacy state file carrying `reviewerRetryCount` and `metadata.gateFailureRetryCount` still imports with zero errors and simply does not materialize the removed fields | Met |
| SC6 — domain deletions | `git grep -n "recordGateFailureRetry\|recordHookFailureRetry\|recordReviewRetry" -- src/` → zero hits; `git grep -n "gateFailureRetryCount\|hookFailureRetryCount" -- src/domain/review.ts` → zero hits. Compile-enforced: `npx tsc --noEmit -p tsconfig.json` exits 0 with the fields removed from the `Review` interface, so every construction site was updated | Met |
| SC6 — `mission-store.ts` no longer reads or writes the columns | `git grep -n "gate_failure_retry_count\|hook_failure_retry_count" -- src/` matches only migrations `0009`/`0012`/`0016`; the store's `SELECT` and `INSERT … ON CONFLICT` for `mission_reviews` no longer name them. Round-trip proof: `"mission round-trips (store serialize → reload) without the removed fields; historical round counts stay"` runs against a database where migration 0016 has dropped the columns, so a lingering read or write would throw | Met |
| SC9 — no dual persistence on any review-loop path | The two timeout-recovery loops were the last persisting readers; they now use round-local variables and their `persistReviewStateOrThrow` calls are deleted. `"startReviewLoop performs recovery relaunches without persisting any retry count"` and `"startReviewLoop performs the implementer recovery relaunch without persisting any retry count"` (`test/review.test.ts`) fail if any write carries a retry count; `"dispatchArtifactFailure persists no retry state anywhere"` (`test/review-artifact-dispatcher.test.ts`) covers the artifact path; the kernel's zero-writes contract is pinned by `"task-2377.03: the kernel writes nothing to a state store while spending a whole budget"` (`test/task-2377.03-rebound-kernel.test.ts`). `ADR 0053` authority boundary advanced: the kernel's in-memory per-occurrence budget is now the only retry state in the review loop | Met |
| SC8 — preserved behavior unchanged | `npm test -- test/review-artifact-dispatcher.test.ts test/review-artifacts.test.ts test/task-1268-pre-review-gate-per-round.test.ts test/task-1383-active-gate-failure-prompt.test.ts test/task-2377.03-rebound-kernel.test.ts test/task-2377.04-per-round-rebound-cap.test.ts` → 116 pass / 0 fail. The max-attempts cap, gatekeeper pushback, and stale BLOCKED/PARKED recovery paths are untouched by this checkpoint's diff; the recovery bound stays 2 and the escalation reason stays `REVIEWER_NON_APPROVAL`, asserted by the three TASK-2233 tests above | Met |
| No-copied-override-regex item | `git grep -nE "RegExp|/\^|human-only|humanOnly|override" src/adapters/review/review-gate-handling.ts` → one hit, a doc comment; no hook regex or human-only override rule remains to delete (as TASK-2377.03 predicted) | Met (nothing to delete) |
| Mission gates on the CP-4 tree | `./scripts/verify-local.sh all` → exit 0, 1941 pass / 0 fail; `./scripts/verify-local.sh docs` → exit 0 | Met |

**Note on SC5's literal zero-hit grep.** SC5 asks for zero `src/` references to the removed
names, but the mission's Out of Scope and Risks sections simultaneously require the
`mission_review_rounds` round columns `reviewer_retry_count` / `implementer_retry_count` —
and therefore the `ReviewRound.reviewerRetryCount` / `implementerRetryCount` fields that
carry them — to survive, with historical values round-tripping unchanged. Those two
requirements cannot both hold literally. This checkpoint satisfies the deletion the mission
describes (every *review-state* field, metadata key, domain review-level field, record
method, and `mission_reviews` column) and leaves exactly the round-level fields the mission
protects; `"mission round-trips (store serialize → reload) without the removed fields;
historical round counts stay"` pins that the surviving fields still round-trip. No stop rule
fires: nothing here drops a `mission_review_rounds` column or changes the schema beyond the
two `mission_reviews` columns.

Next action: CP-5 — final verification and the `docs/agents.md` "Pre-review bounce policy"
update per SC10, then the mission-final Goal Check table over SC1–SC10.
