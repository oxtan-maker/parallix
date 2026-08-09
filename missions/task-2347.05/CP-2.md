# CP-2: Domain types aligned

## Summary

Audited the two domain types the refactor depends on. Neither needs a change,
which is the outcome the mission checkpoint predicted.

`MissionOutcome` (`src/domain/usage.ts:96`) already carries every field the fix
needs: `createdAt` (`:99`), `closedAt` (`:101`), `cycleTimeMinutes` (`:103`) and
`runs: readonly AgentRunMeasurement[]` (`:106`). These arrived with task-2347.04.
The defect is entirely in the adapter that fills them, not in the shape.

`AgentRunMeasurement` (`src/domain/usage.ts:82`) is field-for-field satisfiable
from a `UsageRecord` (`src/application/ports/mission-measurements.ts:1`):

| AgentRunMeasurement field | UsageRecord source |
|---|---|
| `recordedOn` | `date` |
| `stage` | `stage`, validated against `AGENT_WORK_STAGES` (`src/domain/usage.ts:24`), `default` otherwise |
| `role` | derived from `stage`: `review` → `reviewer`, otherwise `implementer` |
| `agent` | `reviewer_agent` for the reviewer role, else `implementer_agent` ?? `implementer` |
| `runtime.provider` / `runtime.model` | `provider` / `model` |
| `durationMinutes` | `duration_minutes` |
| `tokens.input/output/cached/context` | `input_tokens` / `output_tokens` / `cached_tokens` / `context_tokens` |
| `toolCalls` | `tool_calls` |
| `providerUsage.beforePercent/afterPercent/deltaPercent` | `openai_usage_before` / `openai_usage_after` / `openai_usage_delta` |
| `costUsd` | `cost_usd` |

Every `UsageRecord` field is optional, and every `AgentRunMeasurement` value is
a `Measurement<T>` (`src/domain/usage.ts:5`), so an absent column maps to
`{ kind: 'unavailable', reason }` rather than to a fabricated zero. That is what
lets `sumMeasured` (`src/domain/usage.ts:142`) return `null` instead of an
understated total when a column is missing — the behaviour SC6 must preserve.

The one column with no `AgentRunMeasurement` home is `closed`, which is a
mission-lifecycle fact, not a run fact; it stays where it is, selecting which
outcomes are complete.

No files were modified at this checkpoint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `MissionOutcome` interface needs no change (already has `createdAt`, `closedAt`, `cycleTimeMinutes`, `runs`) | `src/domain/usage.ts:96`, `src/domain/usage.ts:99`, `src/domain/usage.ts:101`, `src/domain/usage.ts:103`, `src/domain/usage.ts:106` | PASS |
| `AgentRunMeasurement` fields are sufficient for usage-record mapping | `src/domain/usage.ts:82`, `src/application/ports/mission-measurements.ts:1` | PASS |
| Absent usage columns are representable without fabricating values | `src/domain/usage.ts:5` (`Measurement<T>` union), `src/domain/usage.ts:142` (`sumMeasured` returns `null` on any unavailable) | PASS |
| Stage vocabulary exists to validate `UsageRecord.stage` | `src/domain/usage.ts:24` (`AGENT_WORK_STAGES`), `src/domain/usage.ts:18` (`AttributedAgentWorkStage`) | PASS |
| Mapping expectations are pinned by the reproduction test | `test/task-2347.05-cycle-time-vs-runtime.test.ts:156`, `"SC2/SC3: every outcome carries one AgentRunMeasurement per usage record"` | PASS (still red — CP-3 implements the mapper) |
| Existing run-shape contract unchanged for consumers | `test/domain-outcomes.test.ts:37` (`run()` fixture), `src/domain/usage.ts:181` (`totalDurationMinutes`) | PASS |

Next action: CP-3 — rewrite `usageRecordsToOutcomes` in `src/application/projections/metrics-read-adapter.ts:119` to take lane-event entries, derive `createdAt`/`closedAt`/`cycleTimeMinutes` from them, and emit one `AgentRunMeasurement` per usage record.
