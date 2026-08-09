# CP 4 — Truthful completion flow and final verification

Reworked scalar cumulative flow to count missions that have reached `done` at
each instant; the per-state flow remains the board distribution. Updated the
operator narrative and FLOW copy to describe weekly completions accurately,
updated affected fixtures and durable line citations, and completed the
mission-declared verification gate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: MissionOutcome has createdAt and closedAt | `src/domain/usage.ts:96` | PASS |
| SC2: adapter returns only dated closed outcomes with timestamps | `src/application/projections/metrics-read-adapter.ts:117` | PASS |
| SC3: weekly throughput groups closures by ISO week | `src/application/projections/metrics.ts:324`; `"throughput excludes active and review telemetry, and weekly buckets use closure week"` | PASS |
| SC4: throughput excludes future closures | `src/application/projections/metrics.ts:204`; `"historical metrics exclude outcomes closed after each instant"` | PASS |
| SC5: median state time excludes future closures | `src/application/projections/metrics.ts:121`; `"historical metrics exclude outcomes closed after each instant"` | PASS |
| SC6: review-loop rate excludes future closures | `src/application/projections/metrics.ts:230`; `"historical metrics exclude outcomes closed after each instant"` | PASS |
| SC7: cumulative flow is a varying completed-mission measure | `src/application/projections/metrics.ts:147`; `"cumulativeFlowSeries tracks completed transitions over time"` | PASS |
| SC8: bottleneck wording names the latest recorded week | `src/application/projections/metrics.ts:390` | PASS |
| SC9: FLOW label names weekly completions | `src/interfaces/tui/flow-panel.tsx:54`; `"FLOW panel renders projection labels, values, unavailable agent, and bottleneck sentence"` | PASS |
| SC10: declared verification gate passes | `./scripts/verify-local.sh all` (1,805 tests passed) | PASS |
| SC11: red-to-green reproduction is present and green | `test/task-2347.04-throughput-truthful.test.ts`; `"throughput excludes active and review telemetry, and weekly buckets use closure week"` | PASS |

Next action: Submit the committed mission artifacts for the Parallix-managed lifecycle transition.
