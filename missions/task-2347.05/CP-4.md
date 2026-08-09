# CP-4: Metrics updated

## Summary

`medianStateTimes` (`src/application/projections/metrics.ts:119`) keeps reading
`outcome.cycleTimeMinutes`, but that value now carries the lifecycle span CP-3
derives from lane events, so the median it publishes is delivery-system time
rather than agent execution time. Its doc comment states the distinction and
names its counterpart instead of leaving the reader to guess
(`src/application/projections/metrics.ts:110`).

Added the counterpart so agent efficiency has a home of its own:

- `agentRuntimeMinutes` (`src/application/projections/metrics.ts:146`) totals
  one outcome's measured run durations from `outcome.runs`.
- `medianAgentRuntime` (`src/application/projections/metrics.ts:161`) is the
  median of those totals across missions closed by each instant. Outcomes with
  no measured duration are dropped rather than counted as zero, so an
  unmeasured mission never drags the median down; when every outcome is
  unmeasured the series value is `null`, matching the declared
  `missingHistoryFallback: 'null'`.

`BoardMetrics` gained `medianAgentRuntime`
(`src/application/projections/board.ts:132`) beside `medianStateTimes`, each
with a doc comment naming what it measures. Both overloads of
`buildBoardMetrics` supply an empty runtime series
(`src/application/projections/board.ts:176`,
`src/application/projections/board.ts:249`), and `buildMetrics` overrides it
with the real series (`src/application/projections/metrics.ts:476`) — the
positional overload could not absorb an eleventh argument without becoming
unreadable.

`CompletedMissionStatistics` was not touched: it already sums runtime from
`outcome.runs` via `totalDurationMinutes` (`src/domain/usage.ts:181`), and the
Restricted Areas section forbids altering it. What changed is that its `runs`
input is no longer empty, so its totals are now real instead of `null`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4: `medianStateTimes` derives the median from lifecycle-derived cycle time | `src/application/projections/metrics.ts:119`, `"SC4: medianStateTimes reports the lifecycle cycle time"` | PASS |
| A separate agent-runtime metric exists on `BoardMetrics` | `src/application/projections/board.ts:132`, `src/application/projections/metrics.ts:161` (`medianAgentRuntime`) | PASS |
| Agent runtime and cycle time report different numbers for the same mission | `test/task-2347.05-cycle-time-vs-runtime.test.ts:206`, `"SC5: the board exposes agent runtime separately from cycle time"` | PASS |
| Unmeasured runs are excluded rather than counted as zero minutes | `src/application/projections/metrics.ts:146` (`agentRuntimeMinutes` returns `null` when nothing is measured) | PASS |
| SC6: `CompletedMissionStatistics` unchanged and still sums from `runs` | `src/domain/usage.ts:181`, `"SC6: CompletedMissionStatistics still sums runtime from outcome.runs"` | PASS |
| Existing median/series expectations still hold | `test/board-metrics.test.ts`, `test/board-event-metrics-fixture.test.ts` — 0 failures | PASS |
| Types clean after the `BoardMetrics` widening | `npm run typecheck` — no output | PASS |

Next action: CP-5 — render the two series in the FLOW panel (`src/interfaces/tui/flow-panel.tsx`) under labels that cannot be read as each other, and audit the remaining board strings that say "cycle time".
