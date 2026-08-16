# CP-2 — Red lifecycle timing tests

## Summary

Authored `test/task-2376-lifecycle-timing.test.ts` with R1–R3 and R8 plus
sensitivity tests. Ran against CP-1 baseline (`3be36acd6`).

### Baseline failures

- **R8 RED** — `decideMission(mission('review'), { type: 'integrate' })` returns
  `done` instead of throwing `MissionRuleViolation`. Domain `integrate` case
  accepts `['review', 'integration']`; fix in CP-5 narrows to `['integration']`.
- **R1 GREEN** — Domain `approve` transition correctly moves `review → integration`
  and preserves `Review` with `decidedAt`. The defect is caller-side:
  `src/adapters/cli/commands/integrate.ts:879` passes `occurredAt: new Date().toISOString()`
  instead of `ReviewerDecision.decidedAt`. R1 documents the target behavior;
  the wiring fix ships in CP-3.
- **R2 GREEN** — Dwell projection (`deriveLaneIntervals` +
  `medianCycleTimeByStateSeries`) produces review=30m, integration=225m when
  transitions use `decidedAt`. The R2 sensitivity test proves the old bug:
  wall-clock approve shifts dwell to review=240m, integration=15m.
- **R3 GREEN** — Domain `approve` transition from stale `review` state works
  correctly. The defect is the same caller-side `new Date()` in
  `promoteTaskForIntegrationIfNeeded`. R3 documents the target; wiring fix in CP-3.

### Sensitivity tests

- **R2 sensitivity** — Wall-clock approve (14:00) produces review=240m,
  integration=15m instead of 30m/225m. Proves old-bug sensitivity for R2/R3.
- **R8 sensitivity** — Current `review → done` shortcut skips integration lane
  entirely, so integration dwell is never measured. Proves old-bug sensitivity
  for R8.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| R1–R3 and R8 regression tests authored | `test/task-2376-lifecycle-timing.test.ts` (6 tests: R1, R2, R2-sensitivity, R3, R8, R8-sensitivity) | PASS |
| R8 fails on baseline (domain `integrate` accepts `review`) | `test/task-2376-lifecycle-timing.test.ts` `"R8: direct review → done forbidden"` — `AssertionError: Missing expected exception` | PASS |
| R2 sensitivity proves wall-clock defect | `test/task-2376-lifecycle-timing.test.ts` `"R2 sensitivity: wall-clock approve shifts dwell"` — review=240m, integration=15m | PASS |
| R8 sensitivity proves review→done shortcut | `test/task-2376-lifecycle-timing.test.ts` `"R8 sensitivity: review → done shortcut"` — status=done without integration lane | PASS |
| Tests compile (no focused/skipped) | `npx tsc --project tsconfig.test.json --noEmit` — no errors in test file; `npx tsx --test` — 0 skipped | PASS |

Next action: CP-3 — move normal approval to authoritative boundary. Wire `ReviewerDecision.decidedAt` into `review → integration` transition at `ReviewState.save()` (the single shared chokepoint all approval paths route through).
