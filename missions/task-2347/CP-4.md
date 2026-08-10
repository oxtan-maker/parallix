# CP-4 — Production proof and closure

Completed the production-path regression proof across repository scope, worktree identity, atomic lifecycle history, completion/closure timing, telemetry absence, offset bucketing, current-week zero, canonical cohort metadata, CLI/board agreement, review metrics, and provenance. The full mission gate passes with 1,901 tests and no skips.

The active parent Backlog record retains its locked duplicate-but-equivalent `labels` encodings; the catalog round-trip suite now identifies this as a named legacy serialization exception instead of changing the parent task’s status, assignee, labels, or lifecycle metadata. TASK-2347.01 through .10 are closed records in `backlog/completed/`; .01 is covered by repository identity tests, .02–.06 by lifecycle/temporal tests, .07 by provenance tests, .08 by CLI/board agreement tests, .09 by cohort tests, and .10 by review-fix-round tests. Legacy CSV remains an explicit read-only import boundary in `src/adapters/cli/commands/stats.ts`; no legacy row is part of the repository-scoped production projection.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 repository scope and worktree identity exclude cross-repository contamination | `test/task-2347-01-repository-identity-repro.test.ts`, `src/composition/production-capabilities.ts:37` | PASS |
| SC2–SC5 lifecycle history, completion, dwell, historical windows, offset bucketing, and current zero week are proven | `test/task-2347.02-lifecycle-history.test.ts`, `test/task-2347.03-inverted-dwell-repro.test.ts`, "lifecycle completion survives absent telemetry, ignores later close, and emits current-week zero" | PASS |
| SC6 runtime is separate and unavailable telemetry does not become zero | `test/task-2347.05-cycle-time-vs-runtime.test.ts`, `test/task-2347.07-statistics-provenance.repro.test.ts` | PASS |
| SC7 review bounce and fix-round semantics have authoritative regression coverage | `test/task-2347.09-bounce-rate.test.ts`, `test/task-2347.10-repro.test.ts` | PASS |
| SC8–SC9 cohort presentation and shared CLI/BoardMetrics semantics agree | `test/task-2347.09-cohort-presentation.test.ts`, `test/task-2347.08-own-statistics-semantics-repro.test.ts` | PASS |
| SC10 authoritative user-visible metric contract is checked | `docs/metric-contract.md:5`, "statistics metric contract names every board and CLI decision metric with its semantic inputs" | PASS |
| SC11 deterministic fixture coverage contains repository/worktree, completion/closure, missing telemetry, offset, zero-week, and cohort proof | `test/task-2347-01-repository-identity-repro.test.ts`, `test/task-2347.04-throughput-truthful.test.ts`, `test/task-2347.09-cohort-metrics.test.ts` | PASS |
| SC12 obsolete catalog exception is explicit and the mission gate passes | `test/task-2284-catalog-round-trip.test.ts:211`, `./scripts/verify-local.sh all` | PASS |

Next action: Mission complete; Parallix may perform its lifecycle transition and review handoff.
