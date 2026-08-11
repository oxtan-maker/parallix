# CP-3 — Identity and Completion Authority (B, D)

## Summary

Defects B (canonical repository identity) and D (completion population) were already fixed at baseline. Proved by green regression tests with real Git worktree fixture.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| B: Worktree resolves same RepositoryId | `stats-cohorts.ts:209` `resolveCanonicalRepositoryId(rootDir)`; `stats.ts:281` same; test `task-2357.b-canonical-repository-identity.test.ts` "resolves px stats cohorts to the primary checkout identity" PASS | Green |
| B: No process.cwd() as final identity | `stats.ts:140-145` `resolveStatsRepoName()` falls back to `resolveCanonicalRepositoryId()`; `stats-cohorts.ts:209` same | Green |
| B: Cross-repo isolation | `metrics-read-adapter.ts:219` `scopedRecords` filtered by `repositoryId`; test "produces identical BoardMetrics from primary and worktree" PASS | Green |
| D: Lifecycle done = completion | `metrics-read-adapter.ts:283-284` `lifecycle?.completedAt` as authority; telemetry-only fallback only when no lifecycle; test `task-2357.d-completion-population.test.ts` PASS | Green |
| D: No telemetry still completed | `metrics-read-adapter.ts:294-302` lifecycle-only mission gets outcome with `reviewFixRounds: null`; test "reports exactly the lifecycle-completed missions" PASS | Green |
| D: Telemetry without done = not completed | `metrics-read-adapter.ts:284` `completedAt === null` → skip; test "gives the shared CLI mission-flow report the same population" PASS | Green |
| D: Board and CLI same population | `metrics-read-adapter.ts:280-310` lifecycle authority; `stats-report.ts:36-67` `missionFlowSection` uses `MissionOutcome[]` | Green |

## Next Action

CP-4 — fix C (reviewFixRounds nullable) and G (per-metric low-sample).
