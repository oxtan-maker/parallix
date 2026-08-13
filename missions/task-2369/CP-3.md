# CP-3 — Part C: the landed commit's own timestamp is the completion time

## Summary

`persistLandedIntegrationOrAbort()` now resolves the delivery completion time
from the **specific** landed commit and passes it to
`decideIntegration()` as `occurredAt`, instead of letting the service fall back
to `new Date()`.

- New helper `resolveLandedCommitTimestamp(landedCommit, rootDir)` in
  `src/adapters/cli/commands/integrate.ts` runs
  `git show -s --format=%cI <landedCommit>`. It reads the supplied revision, not
  `git log -1` / HEAD — the resume path reconciles a squash commit that landed
  in an earlier run and can sit well behind HEAD (SC23).
- Resolution lives in the function body, so **all** callers share it: the normal
  landing path and the "squash commit already exists" resume path both call
  `persistLandedIntegrationOrAbort(slug, mergedCommit, missionServices, { rootDir: baseWorktree })`.
- An unreadable revision warns and omits `occurredAt` rather than aborting a
  mission whose work has already landed, or silently backdating it.

**Delivery vs administrative time (SC24/AC16).** The `integration -> done`
event now carries the landed commit time. `integration.close()` deliberately
keeps `new Date().toISOString()` as `closedAt`: it records when the operator
ended the last lane dwell, not when the change was delivered. Both are commented
at their call sites. A mission that landed on August 4 and was closed out on
August 6 therefore reports delivery on August 4 and administrative closure on
August 6, and only the delivery time drives decision windows.

**Mutation sensitivity (recorded, not committed).**

- R4: replacing `occurredAt: landedAt` with `occurredAt: new Date().toISOString()`
  turned both R4 tests red (`'<retry time>' !== '2026-08-04T23:30:00+02:00'`, and
  the window assertion `0 !== 1`). Correct code restored; `grep -c "occurredAt: new Date" src/adapters/cli/commands/integrate.ts` returns 0.
- R1: re-inserting the `lifecycle.transition({ command: { type: 'integrate' } })`
  call into `promoteTaskForIntegrationIfNeeded()` turned R1 and R3 red while R4
  stayed green. Correct code restored; `grep -c "mission:transition" src/adapters/cli/commands/integrate.ts` returns 0.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC03/AC13 landed commit timestamp is resolved and passed as `occurredAt` | `test/task-2369-regressions.test.ts`, `"R4: a resumed integration is stamped with the landed commit time, not the retry time"` | PASS |
| SC04 lane event `occurredAt` equals the landed timestamp for normal and resumed integration | `test/task-2369-regressions.test.ts`, `"R4: a resumed integration is stamped with the landed commit time, not the retry time"` and `"R3: a review-origin integration completes only after the commit has landed"` | PASS |
| SC22/AC14 decision-window membership follows T1, not T2 | `test/task-2369-regressions.test.ts`, `"R4: decision-window membership follows the landed timestamp"` — asserts `current.completedMissions === 0` and `previous.completedMissions === 1` against `ConcreteMetricsReadAdapter` | PASS |
| SC23/AC15 resolved from the specific commit, not `git log -1`/HEAD | `resolveLandedCommitTimestamp()` in `src/adapters/cli/commands/integrate.ts` issues `show -s --format=%cI <landedCommit>`; the R4 fixture's Git double returns a timestamp only for the landed SHA and fails any other revision | PASS |
| Both callers covered by one timestamp resolution | `grep -n "persistLandedIntegrationOrAbort(slug" src/adapters/cli/commands/integrate.ts` — both call sites pass `{ rootDir: baseWorktree }`; resolution happens once in the function body | PASS |
| SC24/AC16 delivery completion stays distinct from administrative closeout | `src/adapters/cli/commands/integrate.ts`, `persistLandedIntegrationOrAbort()` — `occurredAt` from the landed commit, `closedAt` from closeout time, each documented at its call site | PASS |
| AC38 R4 old-bug sensitivity documented and demonstrated | mutation to `new Date().toISOString()` turned `"R4: a resumed integration is stamped with the landed commit time, not the retry time"` red; restored | PASS |
| AC38 R1 old-bug sensitivity documented and demonstrated | re-inserting the promotion transition turned `"R1: backlog promotion cannot complete the Mission when landing fails"` red; restored | PASS |
| Existing integrate coverage unaffected | `npm test -- test/task-2369-regressions.test.ts test/integrate.test.ts` — 74 pass, 2 fail (only R5/R6, which CP-4 fixes) | PASS |

Next action: CP-4 — fix Parts D and E in `src/adapters/cli/commands/stats.ts` (`defaultPrFixRounds()` returning `undefined` and ignoring NULL rows when carrying a prior known maximum forward, `measurementToStatsRow()` preserving SQL NULL, `deriveImplementerAndFixRounds()` unknown-fallback) plus the NULL-collapsing aggregation in `src/application/projections/metrics-read-adapter.ts`, then confirm R5 and R6 turn green.
