# CP-1 — Baseline pinned, defects traced, red regressions authored

## Summary

Pinned the baseline, traced all four defects through the live production call
paths, and authored the TASK-2369 regression set. Six of nine regressions fail
at baseline, each for the defect it locks; three pass and are recorded as
already-correct at baseline (per the mission's "already fixed at baseline?" stop
rule) rather than churned.

**Baseline**

- `BASELINE_SHA=fb40bd716b2a0f6a761a2fbc500533b68857b8d8`
- `git status --short` — clean (no output) at CP-1 start.

**Defect trace (current tree, not the task description)**

| Defect | Live call path | Status at baseline |
|---|---|---|
| 1 — two completion paths | `integrate()` Step 4 → `promoteTaskForIntegrationIfNeeded()` → `missionServices.lifecycle.transition({ command: { type: 'integrate' } })`; `decideMission` maps `integrate` from `review`/`integration` to `done` (`src/domain/mission-workflow.ts` `case 'integrate'`) | **present** |
| 2 — retry time as completion time | `persistLandedIntegrationOrAbort()` calls `decideIntegration()` with no `occurredAt`; the service falls back to `new Date()` (`src/application/mission-integration-service.ts`, `occurredAt: request.occurredAt ?? new Date().toISOString()`) | **present** |
| 3 — unknown review-fix becomes zero | `defaultPrFixRounds()` returns `'0'`; `measurementToStatsRow()` maps SQL NULL to `'0'`; `deriveImplementerAndFixRounds()` unknown-fallback returns `prFixRounds: 0`; `ConcreteMetricsReadAdapter` aggregation does `Math.max(existing ?? -1, record.pr_fix_rounds)` for a NULL record | **present** |
| 3b — canonicalize seam | `canonicalizeStatsRow()` already skips the generic `USAGE_NUMBERS` default for an unknown `pr_fix_rounds`; `normalizeStatsRow()` already maps NULL/undefined to `undefined`; `statsRowToMeasurement()` already maps `undefined` to SQL NULL | **already correct** |
| 4a — telemetry completion | No `closed` / `completed` / `isFinal` / `isCompletedStatisticsRow` field exists in `STATS_HEADERS` or any live report path; completion comes from `completedMissionKeys` supplied by lifecycle readers | **already correct** |
| 4b — canonical repository identity | `resolveStatsRepoName()` delegates to `resolveCanonicalRepositoryId()`; `product.name` survives only as a read-side alias in `legacyStatsRepoAliases()` | **already correct** |

**Regression set authored** — `test/task-2369-regressions.test.ts`. R1–R4 drive
the real `px integrate` orchestration (`integrate.default(...)`) over the real
`MissionLifecycleService` / `MissionIntegrationService` and the real domain state
machine; only Git/Forgejo/worktree/stats boundaries are doubled. Promotion is
**not** mocked away — `setTaskStatus` is observed, not replaced, so the
production promotion body executes.

Baseline run of `npm test -- test/task-2369-regressions.test.ts`: **3 pass,
6 fail**.

| Regression | Baseline | Failure reason at baseline |
|---|---|---|
| R1 | RED | `actual: 'done'` — promotion completed the Mission although the squash commit failed |
| R2 | GREEN | approved path already completes once; retry refused |
| R3 | RED | `integration -> done` event count `0 !== 1` — promotion consumed the transition, and `review -> done` produces no lane event at all |
| R4 (timestamp) | RED | `occurredAt` observed as `'<none>'`, expected `2026-08-04T23:30:00+02:00` |
| R4 (window) | RED | mission absent from the window containing T1 |
| R5 | RED | unknown review-fix count read back as `'0'`, expected `undefined` |
| R6 | RED | `observationCounts.reviewFixRounds` `4 !== 2` |
| R7 | GREEN | telemetry has no completion authority at baseline |
| R8 | GREEN | canonical repository identity correct at baseline |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| AC01 baseline SHA and worktree state recorded | `BASELINE_SHA=fb40bd716b2a0f6a761a2fbc500533b68857b8d8`, `git status --short` clean; reproduce with `git status --short` | PASS |
| AC02 premature-completion bug reproduced at baseline | `test/task-2369-regressions.test.ts`, `"R1: backlog promotion cannot complete the Mission when landing fails"` | PASS (red) |
| Defect 2 reproduced at baseline | `test/task-2369-regressions.test.ts`, `"R4: a resumed integration is stamped with the landed commit time, not the retry time"` | PASS (red) |
| AC14 window membership reproduced at baseline | `test/task-2369-regressions.test.ts`, `"R4: decision-window membership follows the landed timestamp"` | PASS (red) |
| Defect 3 reproduced through the live writer | `test/task-2369-regressions.test.ts`, `"R5: the live review-fix writers keep known zero and unknown apart"` | PASS (red) |
| AC24/AC25 observation count reproduced | `test/task-2369-regressions.test.ts`, `"R6: [0, 2, unknown, unknown] reports exactly two review-fix observations"` | PASS (red) |
| AC37 regressions exercise the defective caller, not only the service | `test/task-2369-regressions.test.ts` drives `integrate.default([SLUG, '--no-integration-gates'], { missionServicesFn })`; R3 asserts the order `['promoted', 'landed', 'completed', 'stats']` | PASS |
| Defect 4 (telemetry completion) already correct at baseline | `test/task-2369-regressions.test.ts`, `"R7: telemetry cannot decide Mission completion"` | PASS (green, no code churn) |
| AC29/AC30 canonical identity already correct at baseline | `test/task-2369-regressions.test.ts`, `"R8: new telemetry writes use the canonical repository id, not product.name"`; existing coverage in `test/task-2363-repository-identity.test.ts` | PASS (green, no code churn) |
| AC39 no agent, LLM, mission runner, or network in certification tests | `test/task-2369-regressions.test.ts` injects Git/Forgejo/process seams and real temporary SQLite via `test/fixtures/task-2357-statistics-fixture.ts`; no agent module is imported | PASS |
| Regression file runs in the default suite (not silently relocated) | `npm test -- test/task-2369-regressions.test.ts`; `buildTestRunPlan` in `test/lib/test-run-plan.ts` includes the file in `defaultTestFiles` | PASS |

Next action: CP-2 — delete the `command: { type: 'integrate' }` lifecycle transition from `promoteTaskForIntegrationIfNeeded()` in `src/adapters/cli/commands/integrate.ts` (keeping its fail-closed mission-store guards), then confirm R1 and R3 turn green and R2 stays green.
