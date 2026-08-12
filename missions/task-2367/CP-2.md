# CP-2: Lock regressions before production changes

Added focused regression guards for the missing post-landing lifecycle write, telemetry-owned completion semantics, and nullable review-fix propagation. The existing `metrics-read-adapter` already preserves a nullable telemetry value; that individual case is recorded green rather than rewritten.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Integration cannot report before authoritative lifecycle persistence | `test/task-2367-integration-completion-repro.test.ts`, `TASK-2367: a landed approved integration persists done once before statistics`; `test/task-2367-regressions.test.ts`, `TASK-2367: integration reporting receives lifecycle persistence` | RED — closeout has no `MissionIntegrationService` call |
| Telemetry cannot own Mission completion | `test/task-2367-regressions.test.ts`, `TASK-2367: contemporary telemetry has no completion field`; `TASK-2367: statistics never select completion from telemetry` | RED — `closed` is persisted and selected |
| Unknown review-fix rounds remain unknown | `test/task-2367-regressions.test.ts`, `TASK-2367: unknown review-fix rounds remain nullable` | GREEN — `metrics-read-adapter.ts` maps absent values to `null` |
| Focused baseline is reproducible | `npx tsx test/run-default-tests.ts test/task-2367-regressions.test.ts` | RED — three required regressions fail at baseline |

Next action: Remove the contemporary telemetry completion contract and schema while retaining a bounded legacy-repair read path.
