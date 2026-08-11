# CP-5 — Production Certification

## Summary

Created `test/task-2357-certification.test.ts` — single test exercising full production path from persisted facts through ConcreteMetricsReadAdapter to BoardMetrics with hand-computed assertions.

## Certification Requirements Met

| Requirement | Evidence | Status |
|---|---|---|
| Real Git primary + worktree | `createPrimaryAndWorktree('cert-repo')` at line 109 | Green |
| Second unrelated repo with colliding ID | REPO_B + task-200 at lines 172-173, asserted at line 243 | Green |
| Migrated SQLite + real persistence repos | `SqliteMigrationRunner`, `SqliteBoardLaneEventRepository`, `SqliteUsageRepository` at lines 113-119 | Green |
| Production canonical identity resolution | `repositoryId('certification-repo')` used throughout; no `process.cwd()` fallback | Green |
| ConcreteMetricsReadAdapter | `new ConcreteMetricsReadAdapter({...})` at line 203 | Green |
| BoardProjectionBuilder | `metrics = await adapter.buildMetrics(initialStates)` at line 214 | Green |
| Injected deterministic clock | `clock: fixedClock(NOW)` at line 207 | Green |
| Hand-computed expected values | Constants at lines 87-91 stated beside fixture description at lines 52-80 | Green |
| Earlier/later intake | task-100..103,105,106 Mon; task-104 Thu; task-107 May 18 | Green |
| Lifecycle-completed with/without telemetry | task-100..104 have telemetry; task-105 lifecycle-only | Green |
| Telemetry without lifecycle done | task-106 closed=yes but still active | Green |
| Known zero/nonzero/unknown reviewFixRounds | task-100(0), 101(2), 102(null), 104(1) | Green |
| Review bounce and no-bounce | task-100 bounced; task-101 no bounce | Green |
| Previous nonzero + current zero week | task-107 done May 25; current week has completions | Green |
| Partial runtime/token/cost coverage | task-102 has runtime no tokens/cost; task-103 nothing | Green |
| Two experiment labels | ai_sdlc (5), user_value (2) | Green |
| Exact population/value assertions | Lines 223-255 assert exact counts and IDs | Green |

## Test Evidence

| Test | Status |
|---|---|
| `test/task-2357-certification.test.ts` "exercises the full production path with hand-computed assertions" | Green |

## Next Action

CP-6 — mutation proof: demonstrate former C and G behavior fails new regressions.
