# Mission: Unblock review retries — stable handoff idempotency key and a review loop bound to the Mission store (task-2339)

## Goal
Make `submit-for-review` transition idempotent so handoff retries do not fail with "Cannot submit-for-review while task-XXXX is review; expected active". Domain fix: accept `submit-for-review` when mission already in `review` status and return current state as no-op. Also remove `Date.now()` from idempotency keys in `handoff.ts` and `integrate.ts` so the DB UNIQUE constraint on `idempotency_key` deduplicates retries.

Second defect, same blockage: bind the review loop to the Mission store so a reviewer's verdict is actually persisted. A retry that now transitions cleanly still cannot leave review while the loop discards every review event it produces.

Fifth defect, the last one standing between the loop and a recorded verdict: a Mission write the loop leaves in flight can outlive the database handle that accepted it. The loop must await its own writes, and composition must drain the store before closing it.

Fourth defect, the one that actually kept the verdict from landing: a `load` that interleaves with a `save` on the shared SQLite handle reads the Mission mid-rewrite and reports its Review as absent. Serialize aggregate access and stop deleting the row the review children cascade from.

Third defect, found in this mission's own review round: an agent family can be recorded as the reviewer of its own work. Handoff's reviewer selection fails open — any error collapses to "reviewer = implementer" — and the domain accepts the result without a word. Close that: the escape hatch stays for a workstation with genuinely no second family, but it must be the only path to self-review, it must say so, and the round must record the eligibility that actually applied.

## Why Now
Handoff relaunches (e.g. after gatekeeper pushback) produce new idempotency keys every time (`handoff-${slug}-${Date.now()}` at `src/adapters/cli/commands/handoff.ts:738`). Second `submit-for-review` hits `requireStatus(mission, ['active'])` at `src/domain/mission-workflow.ts:74` and throws `MissionRuleViolation`. Blocks reliable retry flow. Same pattern in `integrate.ts:1299`.

The transition fix alone does not unblock review. `resolveMissionStore` is a pure dependency-injection passthrough (`return store ?? null`) in `src/adapters/review/review-state.ts:112` and `src/adapters/review/review-events.ts:27`, so any review call site that was never handed the store resolves no authority — and reports that as mission state:

```
[FAIL] Cannot store review event for "task-2339": no Review in the operator database.
[FAIL] Failed to persist reviewer findings to repo store: No Review in the operator database for task-2339
[WARN] Reviewer claude produced incomplete or invalid review artifacts; retrying the reviewer.
```

The Review is in the database; the operator is nonetheless sent to `px review <slug> --backfill-review`, which cannot repair a Review that is already present. The reviewer's verdict is dropped and the loop relaunches the reviewer until it gives up. Two wiring gaps produce it:

1. `src/composition/create-cli.ts` binds `readReviewStateFn`, `writeReviewStateFn` and `resetReviewStateFn` into `startReviewLoop` but not `consumeReviewerArtifactsFn` / `consumeImplementerArtifactsFn`, which then fall back to the unbound module defaults. `px review <slug> --start|--continue` therefore cannot persist any reviewer output.
2. `consumeReviewerArtifacts` / `consumeImplementerArtifacts` call `readReviewState` directly instead of the injected reader, so every event is filed against round 1 / phase `reviewing` regardless of the round in progress.

### Third defect: an agent family reviewing its own work

Round 1 of this mission was recorded with `reviewer = claude` and `implementer = claude` while four families (`codex`, `claude`, `custom`, `vibe`) were configured, installed and runnable for the `review` step. Two causes compound:

1. `resolveHandoffReviewAssignment` (`src/adapters/cli/commands/handoff.ts`) wrapped reviewer selection in a bare `catch {}` that set `reviewer = implementer` for *any* thrown error — pool exhaustion, an unreadable agent policy, a failed launcher probe, custom-capacity contention — and logged nothing. A transient condition therefore produced a permanent, silent self-review.
2. `startReview` / `beginNextReviewRound` (`src/domain/review.ts`) enforce reviewer *eligibility* but never reviewer *separation*, so the aggregate accepted the round and it looks indistinguishable from a cross-family review: the recorded eligibility still named all four families.

### Fourth defect: a concurrent read observes the aggregate mid-rewrite

With the store bound (second defect fixed), the loop still reported `no Review in the operator database` — this time from the `no-review` branch, i.e. the store was present and the mission loaded without its Review. `SqliteMissionStore.save` rewrites the value collections as DELETE-then-INSERT, and `DELETE FROM mission_reviews` cascades to rounds, findings, resolutions, stage launches and the review-event audit trail. The write is transactional, but composition deliberately shares one `DatabaseSync` handle process-wide (`src/composition/application-services.ts`, "shared singleton connection ... avoids database is locked contention"), and a transaction gives a concurrent read *on that same handle* no isolation at all.

The review loop is exactly that workload: it records a reviewer stage launch while consuming reviewer artifacts. The operator database shows the collision — `mission_review_stage_launches` for `review:codex` written at `2026-08-04T10:28:11.486Z`, the same second the artifact consumer failed. Cross-process concurrency keeps SQLite's own isolation; this is purely the window the shared handle opens.

### Fifth defect: a write in flight outlives the handle that accepted it

`recordStageStatsSafeFn` was called without `await` at both review-loop call sites, yet it writes the Review aggregate through the store. Two consequences, both observed: the write raced the artifact consumer that runs next on the same connection (the fourth defect's trigger), and it could still be settling when the command closed the shared handle — `Could not record review stats for task-2339: ... Database is not open. Call open() before using the adapter.`

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single domain function change (`decideMission` case `submit-for-review`), two key-string fixes in CLI commands, one reproduction test

## Scope
- `src/domain/mission-workflow.ts` — `decideMission` case `submit-for-review`: allow `review` in `requireStatus` allowed list; return current mission unchanged when already in `review`
- `src/adapters/cli/commands/handoff.ts:738` — replace `handoff-${slug}-${Date.now()}` with stable `handoff-${slug}`
- `src/adapters/cli/commands/integrate.ts:1299` — replace `integrate-${context.slug}-${Date.now()}` with stable `integrate-${context.slug}`
- `src/composition/review-persistence.ts` — `reviewLoopBindings(store)` returning the complete `startReviewLoop` injection set, plus store-bound artifact consumers
- `src/composition/create-cli.ts`, `src/composition/application-services.ts` — both composition roots spread `reviewLoopBindings(store)` instead of listing bindings by hand
- `src/adapters/review/review-artifacts.ts` — artifact consumers use the injected `readReviewStateFn`
- `src/adapters/review/review-events.ts` — distinguish an unsupplied store from a missing Review in the failure reported to the operator
- `src/domain/review.ts` — `requireSeparateReviewer` on `startReview` and `beginNextReviewRound`: reviewer may equal implementer only when the recorded eligibility is exactly that one family
- `src/adapters/cli/commands/handoff.ts` — narrow the self-review escape hatch to genuine pool exhaustion, log it, and record the eligibility that actually applied
- `src/adapters/sqlite/mission-store.ts` — serialize aggregate load/save/saveWithTransition on the store, upsert `mission_reviews` instead of deleting the row its children cascade from, and expose `drain()`
- `src/adapters/review/review-loop.ts` — await the stage-stats writes instead of firing them and moving on
- `src/application/domain-ports.ts`, `src/composition/application-services.ts` — optional `drain()` on the Mission store port, awaited by the composition-owned close
- `test/` — regression reproduction tests that fail on parent commit (red) and pass after fix (green)

## Out of Scope
- Other `idempotencyKey` usages outside `handoff.ts` and `integrate.ts` (e.g. `backlog.ts`, `mission-store.ts`)
- Restoring a production-store fallback inside `resolveMissionStore` — adapters keep receiving the store from composition
- Removing the single-family escape hatch itself — a workstation with one runnable family must still be able to hand off
- Reviewer separation in the review loop's own fallback selection (`applyAgentFallbackFn`), which already excludes the implementer
- Giving each command its own SQLite connection — commands keep sharing the composition root's handle; only the order of close versus in-flight writes changes
- Converting the remaining value collections (labels, checkpoints, goal checks) from delete-and-reinsert to row-level upserts
- Generalizing idempotency to all transition types (scope limited to `submit-for-review`)
- Changing `BoardLaneEventRepository` UNIQUE constraint behavior
- UI/TUI changes

## Success Criteria
- SC1: `decideMission` with command type `submit-for-review` does not throw when `mission.status` is `review`; returns mission unchanged (idempotent no-op)
- SC2: `handoff.ts` idempotency key is `handoff-${slug}` (no `Date.now()`) at `src/adapters/cli/commands/handoff.ts`
- SC3: `integrate.ts` idempotency key is `integrate-${context.slug}` (no `Date.now()`) at `src/adapters/cli/commands/integrate.ts`
- SC4: Reproduction test fails on parent commit (assertion: retrying `submit-for-review` on `review`-status mission throws) and passes after fix (no throw, returns unchanged mission)
- SC5: `./scripts/verify-local.sh all` passes clean on final tree
- SC6: No new `.only` or bare `.skip` in test files
- SC7: `reviewLoopBindings(store)` returns exactly `readReviewStateFn`, `writeReviewStateFn`, `resetReviewStateFn`, `consumeReviewerArtifactsFn`, `consumeImplementerArtifactsFn`, and both composition roots spread it
- SC8: A store-bound reviewer/implementer artifact consumer appends its events to the Review aggregate, carrying the round in progress rather than a default of 1
- SC9: An event writer with no store supplied reports the missing store and does not name `--backfill-review`; the genuine missing-Review case still does
- SC10: Reproduction test for the binding defect fails on parent commit and passes after fix
- SC11: `startReview` and `beginNextReviewRound` reject `reviewer === implementer` unless the recorded eligibility is exactly that one family
- SC12: handoff falls back to self-review only on pool exhaustion, logs a WARN when it does, and records eligibility narrowed to the implementer's family; any other selection failure propagates
- SC13: Reproduction test for the self-review defect fails on parent commit and passes after fix
- SC14: A `load` that interleaves with a `save` on one connection returns the mission with its Review intact
- SC15: A save that keeps the Review never issues `DELETE FROM mission_reviews`; a save that drops it still clears every review table
- SC16: Reproduction test for the interleaved read fails on parent commit and passes after fix
- SC17: The review loop awaits its stage-stats write before running the next stage
- SC18: `drain()` resolves only after in-flight aggregate work has settled, and the composition-owned close awaits it before closing the database
- SC19: Reproduction test for the in-flight write fails on parent commit and passes after fix

## Risks and Assumptions
- Risk: Returning unchanged mission on `review` status might skip side effects callers expect (e.g. lane event recording). Mitigation: lane event already deduplicated by DB UNIQUE constraint on `idempotency_key`; stable key + no-op return is consistent
- Risk: Existing tests assert `requireStatus(['active'])` behavior. Fix: update test expectations where `review` is now allowed
- Assumption: `submit-for-review` is the only transition needing idempotent retry; other transitions (`activate`, `approve`, `integrate`, `request-changes`) have distinct semantics
- Assumption: Stable key `handoff-${slug}` is sufficient; no need for `reviewRound` suffix because domain idempotency handles re-entrancy

## Checkpoints
- CP 1: Author failing reproduction test under `test/` that asserts `submit-for-review` throws on `review`-status mission. Test must be red on parent commit, green after fix.
- CP 2: Apply domain fix in `decideMission` — add `review` to allowed statuses for `submit-for-review`; return current mission unchanged when already `review`. Fix idempotency keys in `handoff.ts` and `integrate.ts`.
- CP 3: Verify all gates pass. Run `./scripts/verify-local.sh all`. Confirm no focused/skipped tests.
- CP 4: Bind the review loop to the Mission store. Add `reviewLoopBindings`, spread it from both composition roots, thread the injected review-state reader through the artifact consumers, and separate "no store supplied" from "no Review". Red-to-green reproduction test, then rerun `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis`.

- CP 5: Forbid an agent family from reviewing its own work. Domain separation rule plus a narrowed, logged escape hatch in handoff. Red-to-green reproduction test, then rerun both gates.

Reproduction-Test: test/task-2339-submit-for-review-idempotent.test.ts
Reproduction-Test: test/task-2339-review-store-bindings.test.ts
- CP 6: Serialize aggregate access and upsert the review row. Red-to-green reproduction test for the interleaved read, then rerun both gates.

Reproduction-Test: test/task-2339-self-review-forbidden.test.ts
- CP 7: Await the loop's own writes and drain the store before composition closes it. Red-to-green reproduction test, then rerun both gates plus the integration suite.

Reproduction-Test: test/task-2339-aggregate-read-during-write.test.ts
Reproduction-Test: test/task-2339-writes-outlive-close.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| submit-for-review idempotent on review status | `src/domain/mission-workflow.ts:74`, `"submit-for-review does not throw when mission is review"` | PASS |
| handoff idempotency key stable | `src/adapters/cli/commands/handoff.ts:738` | PASS |
| Reproduction test red-to-green | `test/task-2339-submit-for-review-idempotent.test.ts` | PASS |
| Verification gate passed | `` `./scripts/verify-local.sh all` `` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/application/mission-lifecycle-service.ts` — do not modify lifecycle service; fix is scoped to domain `decideMission` and CLI key generation
- `src/adapters/sqlite/board-lane-event-repository.ts` — DB UNIQUE constraint is correct as-is; do not change
- `src/application/ports/operation-history.ts` — interface contract stable; do not modify

## Stop Rules
- Stop if more than 2 existing tests break after domain fix — re-evaluate scope before force-fixing
- Stop if unblocking the loop requires `resolveMissionStore` to open a database itself — that is a composition change, not an adapter change
- Stop if enforcing reviewer separation would make a single-family workstation unable to hand off — the escape hatch narrows, it does not disappear
- Stop if closing the interleaved-read window requires a second SQLite connection — commands share the composition root's handle by design
- Stop if `submit-for-review` idempotent no-op changes observable behavior callers depend on (e.g. lane event emission count) — document and defer
- Stop if stable key causes collision concerns across concurrent missions (should not, `slug` is unique per mission)
