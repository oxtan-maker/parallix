# CP-9: Final verification

Completion is lifecycle-only. The final focused suite covers persisted lifecycle transitions, repeated retry behavior, telemetry isolation, reporting projections, nullable review-fix data, and the bounded repair; the repository verifier then checks the committed tree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Contemporary telemetry has no completion marker | `test/task-2367-regressions.test.ts`, `TASK-2367: telemetry cannot complete an integration Mission and null review fixes stay null`; `src/adapters/sqlite/migrations/0014-remove-usage-closed.sql` | PASS |
| SC2: Telemetry cannot complete an integration Mission | `test/task-2367-regressions.test.ts`, `TASK-2367: telemetry cannot complete an integration Mission and null review fixes stay null` | PASS |
| SC3: Landed integration produces one lifecycle completion and current-window increment | `test/task-2367-certification.test.ts`, `TASK-2367 certification: persisted lifecycle owns success, failure, retry, telemetry, BoardMetrics, and report` | PASS |
| SC4: Failed integration does not complete | `test/task-2367-certification.test.ts`, `TASK-2367 certification: persisted lifecycle owns success, failure, retry, telemetry, BoardMetrics, and report` | PASS |
| SC5: Resume closes once and repeated retry is idempotent | `test/task-2367-certification.test.ts`, `TASK-2367 certification: persisted lifecycle owns success, failure, retry, telemetry, BoardMetrics, and report` | PASS |
| SC6: Integration closeout uses `MissionIntegrationService` | `test/task-2367-integration-completion-repro.test.ts`, `TASK-2367: successful integration persists lifecycle completion exactly once` | PASS |
| SC7: Integration reporting, standalone stats, and BoardMetrics share lifecycle completion | `test/task-2347.08-own-statistics-semantics-repro.test.ts`, `task-2347.08 repro: CLI and board agree on identity, completions, and cycle time`; `test/task-2367-certification.test.ts` | PASS |
| SC8: FLOW windows use selected seven-day lifecycle population | `test/task-1415-closed-mission-counts.test.ts`, `task-1415: recordPostIntegrationStats counts a closed mission in the current week even when the base worktree tip commit is stale` | PASS |
| SC9: Review-fix rounds preserve `0`, positive, and unknown values | `test/task-2367-regressions.test.ts`, `TASK-2367: telemetry cannot complete an integration Mission and null review fixes stay null`; `test/review-stats.test.ts` | PASS |
| SC10: Worktree telemetry joins the owning repository | `test/task-2347.08-own-statistics-semantics-repro.test.ts`, `task-2347.08 repro: CLI and board agree on identity, completions, and cycle time` | PASS |
| SC11: Repair is bounded, idempotent, and reports lifecycle plus skipped-ID counts | `test/task-2367-repair.test.ts`, `TASK-2367: repair closes only the two approved historical missions before removing telemetry closed`; `scripts/repair-task-2367.ts` | PASS |
| SC12: Deterministic certification uses a real worktree plus persisted local components without agents or network | `test/task-2367-certification.test.ts`, `TASK-2367 certification: persisted lifecycle owns success, failure, retry, telemetry, BoardMetrics, and report` | PASS |
| SC13: Whitespace and repository verification pass | `git diff --check`; `./scripts/verify-local.sh all` | PASS |

Next action: Commit the review-fix resolution and return it to the active reviewer.
