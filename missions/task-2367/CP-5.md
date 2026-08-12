# CP-5: Align reporting with lifecycle completion

The CLI report now receives the same `MissionOutcome` population as BoardMetrics, identifies each completed Mission by canonical repository plus Mission ID, and joins telemetry only for those lifecycle-completed IDs. Telemetry-only records cannot become outcomes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| BoardMetrics excludes telemetry-only completion | `test/task-2357-certification.test.ts`, `exercises the full production path with hand-computed assertions` | PASS |
| CLI receives lifecycle population with canonical repository identity | `src/adapters/cli/commands/stats.ts`, `readMissionFlowPopulation`; `src/adapters/cli/commands/stats-report.ts` | PASS |
| Worktree telemetry joins its owning repository | `test/task-2363-repository-identity.test.ts`, `joins new lifecycle and measurement data written from either checkout` | PASS |
| Rolling completed populations remain lifecycle-windowed | `test/task-2357-certification.test.ts`, `exercises the full production path with hand-computed assertions` | PASS |

Next action: Verify nullable review-fix round writes/reads and implement the bounded local database repair using archived legacy evidence.
