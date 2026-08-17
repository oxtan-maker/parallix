# CP-3 — Non-silent boundary and Backlog ordering

## Summary

Made the `review → integration` boundary failure operator-visible and ordered every
approval-producing Backlog promotion after a successful boundary transition. Bound the one
unbound approval-producing site the CP-2 audit flagged. Drove CP-1 case 2 to green without
touching case 1 (still red until CP-4 makes the store required).

**Changes**

1. `src/adapters/review/review-state.ts` — `ReviewState.save()` now returns a new
   `ReviewStatePersistenceResult` variant `{ outcome: 'boundary-failed'; stage: 'boundary'; diagnostic }`
   when a `review → integration` transition fails **while the Mission is still in the `review`
   lane**. The condition is Mission status, not prior-decision: a re-run of approval after a
   failed boundary is still surfaced (the Mission has not left `review`), whereas a bookkeeping
   re-persist of an already-approved round once the Mission has moved to `integration` keeps the
   historical non-fatal behavior (an `approve` transition can never legitimately complete there,
   so comments / artifact consumption after approval never break on a replayed transition).
   `assertReviewStatePersisted` throws on `boundary-failed`, so `persistReviewStateOrThrow`
   propagates it. Save/retry/version logic is untouched (Restricted Area honored).

2. `src/adapters/review/review-commands.ts` — `submitReviewRound` (both provider=none and
   provider branches) wraps the approval persist in try/catch. On failure it logs an
   operator-visible `FAIL` plus a `Recovery: px integrate <slug>` hint and `exit(1)` **before**
   the Backlog `transitionTaskFn` call, so the Backlog task is not promoted to `approved` while
   the Mission remains `review`. Backlog promotion now runs only after the persist (and thus the
   boundary) succeeds. No new review command types added (Restricted Area honored).

3. `src/adapters/review/review-loop.ts` — the autonomous reviewer's `APPROVED` branch wraps the
   persist in try/catch and, on boundary failure, logs the failure + recovery hint and returns
   **without** calling `transitionVirtualFn(transitionTaskFn, slug, 'approved', ...)`. The
   Backlog task is only promoted after a successful transition.

4. `src/adapters/review/review-artifacts.ts` — `consumeReviewerArtifacts` now forwards
   `writeReviewStateFn: options.writeReviewStateFn` into `postWorkflowReview` →
   `recordLocalReviewVerdict`. This closes CP-2 audit site 3: the loop's self-author local
   verdict path now persists through the same composition-bound approval boundary as every other
   approval-producing site, instead of the unbound module default.

**Verification**

- CP-1 case 2 `"failed approval boundary transition surfaces and blocks Backlog promotion"` is
  GREEN: the failure is operator-visible, the Backlog task is not transitioned to `approved`, and
  the Mission stays `review` for `px integrate` recovery. Case 1 remains RED (store still
  optional — CP-4 scope).
- No regression: `test/task-2376-lifecycle-timing.test.ts` 11/11, `test/integrate.test.ts` 72/72
  (R4/R7/R9 recovery matrix, decidedAt preservation), and the review / rebase / handoff suites
  (review-commands, review-artifacts, review-events, review-backfill, review-loop,
  rereview-after-response, reviewer-family-repro, handoff, repair-handoff, rebase,
  post-integrate-hook, integrate-guard) all pass — 396 + 232 tests green.
- ESLint clean, `tsc --noEmit` clean, test-hygiene clean. The only remaining test-typecheck error
  is `test/task-2378-authoritative-stats.test.ts:176` — case 1 calls
  `createStatsWorkflowAdapter(fixture.store)`, one argument against the current zero-arg
  signature. That is the locked pre-CP-4 API gap and clears once CP-4 makes the store required.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `save()` reports the boundary transition outcome in the persistence result | `src/adapters/review/review-state.ts` (`boundary-failed` variant + status-gated return) | PASS |
| Approval failure is operator-visible and non-zero | `src/adapters/review/review-commands.ts` (`submitReviewRound` try/catch → `FAIL` + `exit(1)`), `"failed approval boundary transition surfaces and blocks Backlog promotion"` | PASS |
| Backlog promotion ordered after a successful transition | `src/adapters/review/review-commands.ts` + `src/adapters/review/review-loop.ts` (promotion moved after the guarded persist) | PASS |
| CP-1 case 2 green, case 1 unchanged (red) | `test/task-2378-authoritative-stats.test.ts` → 1 pass / 1 fail (case 1 still `missing-authority`) | PASS |
| Every approval-producing site bound to a lifecycle service | `src/adapters/review/review-artifacts.ts` (forwarded bound `writeReviewStateFn`), `src/composition/review-persistence.ts` | PASS |
| Restricted areas honored (no save/retry rework, no new command types) | Diff limited to boundary outcome + propagation/ordering in `review-state.ts` / `review-commands.ts` / `review-loop.ts` / `review-artifacts.ts` | PASS |
| No regression in task-2376 + review/rebase/handoff suites | `test/task-2376-lifecycle-timing.test.ts` 11/11, `test/integrate.test.ts` 72/72, review/rebase/handoff suites 396 + 232 green | PASS |

Next action: CP-4 — drop the optional-store defaults in `loadMissionReview` /
`deriveImplementerAndFixRounds` / `recordIntegrationStats` / `recordPostIntegrationStats`,
thread the operator store through `createStatsWorkflowAdapter` + `StatsWorkflowPort` +
`stats-backfill`, and update R13 to the new semantics (SC02/SC03/SC04/SC08).
