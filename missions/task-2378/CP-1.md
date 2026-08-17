# CP-1 — Red reproduction test (bug lock)

## Summary

Recorded the baseline and authored `test/task-2378-authoritative-stats.test.ts` with the two
failing cases the mission requires.

**Baseline**

- `BASELINE_SHA` = `0938a9a59627d9810b78e5620a03de9357c2ffad`
- `git status --porcelain` at baseline: ` M package-lock.json` (pre-existing worktree drift, untouched by this mission)

**Case 1 — `"live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate"`**

Seeds a mission in the operator database with a Review aggregate carrying two
`request-changes` reviewer outcomes followed by an approval, plus a deliberately
misleading backlog task (`assignee: [codex]`, "Review round 7"). It then derives
through the production adapter `createStatsWorkflowAdapter(store)` and asserts
`source: 'review-aggregate'`, `implementer: 'configured-implementer'`, `prFixRounds: 2`.

RED on the parent commit because `createStatsWorkflowAdapter` in
`src/adapters/cli/commands/stats.ts` takes no `MissionStore` and calls
`deriveImplementerAndFixRounds(slug, rootDir)` with the store omitted.

**Case 2 — `"failed approval boundary transition surfaces and blocks Backlog promotion"`**

Seeds a mission in `review` with an awaiting Review, binds review persistence to a
lifecycle service whose `transition` always returns `status: 'failed'`, and drives an
approval through `submitReviewRound` (provider=none path). It asserts the failure is
operator-visible, that the Backlog task is not transitioned to `approved`, and that the
Mission stays in `review`.

RED on the parent commit because `ReviewState.save()` in
`src/adapters/review/review-state.ts` discards the failed transition as "non-fatal" and
`submitReviewRound` promotes the Backlog task regardless.

**Captured baseline failure output** (`npx tsx --test test/task-2378-authoritative-stats.test.ts`):

```
✖ live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate
  AssertionError: production stats wiring must read the Review aggregate
  + actual - expected
  + 'missing-authority'
  - 'review-aggregate'

✖ failed approval boundary transition surfaces and blocks Backlog promotion
  AssertionError: a failed review → integration transition must be operator-visible, not swallowed
    actual: false, expected: true

ℹ tests 2   ℹ pass 0   ℹ fail 2
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Baseline SHA and working-tree state recorded (AC01) | `BASELINE_SHA = 0938a9a59627d9810b78e5620a03de9357c2ffad`; `git status --porcelain` reported only ` M package-lock.json` | PASS |
| Reproduction test file exists at the mission-declared path | `test/task-2378-authoritative-stats.test.ts` | PASS |
| Case 1 locks the missing-store stats defect (SC01) | `"live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate"`, target `src/adapters/cli/commands/stats.ts` (`createStatsWorkflowAdapter`) | PASS (RED as designed) |
| Case 2 locks the swallowed approval-boundary defect (SC01) | `"failed approval boundary transition surfaces and blocks Backlog promotion"`, targets `src/adapters/review/review-state.ts` (`save`) and `src/adapters/review/review-commands.ts` (`submitReviewRound`) | PASS (RED as designed) |
| Both cases are red on the parent commit, with exact output captured | `npx tsx --test test/task-2378-authoritative-stats.test.ts` → `tests 2 / pass 0 / fail 2` (output quoted above) | PASS |
| No external inference is exercised by the tests (AC40) | Test seeds only the SQLite operator store and a misleading backlog file; no network, agent, or PR lookup is invoked in `test/task-2378-authoritative-stats.test.ts` | PASS |
| No focused or unannotated skipped tests introduced (SC14) | `test/task-2378-authoritative-stats.test.ts` uses only `test(...)`; no `.only` / `.skip` | PASS |

Next action: CP-2 — classify every `writeReviewState` / `persistReviewStateOrThrow` / `ReviewStatePersistence.save` / `createEvent` call site under `src/` as approval-producing or not, confirm 0 grep matches for the four deleted inference helpers, and run `test/task-2376-lifecycle-timing.test.ts` + `test/integrate.test.ts` green to confirm task-2376's landed parts.
