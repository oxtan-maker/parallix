# CP-6: Integration verified

## Summary

`./scripts/verify-local.sh all` exits 0 on the committed tree: 1830 tests, 0
failures. `npm run typecheck` is clean, and `npx eslint` reports nothing on
every file this mission changed.

Rerun on the final committed tree: exit 0, 1811 tests, 0 failures. The reported
total varies between identical runs of the default suite; the failure count is
0 in both runs and the gate exits 0.

Review-round cleanup keeps the repository-scoping fixture chronologically
valid: its `submit-for-review` transition now occurs at 08:15, between the
08:00 activation and 08:45 closure. Its 45-minute lifecycle assertion and
repository-scoping coverage are unchanged.

The focused repository-scoping test passes (6 tests, 0 failures), and the
required gate rerun passes with 1853 tests and 0 failures.

Running the full gate surfaced one real defect the targeted runs had not:
`test/task-2347-01-repository-identity-repro.test.ts` failed with
`0 !== 45`. Its alpha mission has lane events but no `done` lane event, so the
outcome took its opening from a lane event (08:00) and its closure from a usage
date (00:00) — a span running backwards, clamped to 0. Fixed in
`src/application/projections/metrics-read-adapter.ts:219`: the lane window is
used only when it has both ends, otherwise both ends come from usage dates, so
the two clocks are never mixed. `test/task-2347.05-cycle-time-vs-runtime.test.ts:200`
pins that case.

That test's own assertion also encoded the defect this mission removes — it
probed repository scoping by asserting that alpha's cycle time equalled alpha's
`duration_minutes` (45). Its purpose is scoping, not conflation, so alpha now
gets a `done` lane event 45 minutes after activation
(`test/task-2347-01-repository-identity-repro.test.ts:129`). The constant, the
assertion and the scoping guarantee are unchanged; only the quantity's source
moved from usage rows to lane events.

Final state of the change:

- Cycle time is the lane-event lifetime (`metrics-read-adapter.ts:226`).
- `runs` carries one `AgentRunMeasurement` per usage record
  (`metrics-read-adapter.ts:365`); the adapter emits no `runs: []`.
- `medianAgentRuntime` is a first-class board metric
  (`src/application/projections/metrics.ts:161`,
  `src/application/projections/board.ts:132`).
- FLOW labels the two quantities separately
  (`src/interfaces/tui/flow-panel.tsx:68`, `:70`).
- `CompletedMissionStatistics` is untouched and now receives real runs.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: red-to-green test with runtime and lifetime differing by ≥1 minute asserts cycle time is the lifetime (1560 min vs 37 min) | `test/task-2347.05-cycle-time-vs-runtime.test.ts:144`, `"SC1: cycle time reflects the lifecycle wall clock, not the summed agent runtime"` | PASS |
| SC2: `usageRecordsToOutcomes` computes cycle time from lifecycle events | `src/application/projections/metrics-read-adapter.ts:295` (`missionLifecycles`), `src/application/projections/metrics-read-adapter.ts:226` (`cycleTimeMinutes: elapsedMinutes(createdAt, closedAt)`) | PASS |
| SC2: one `AgentRunMeasurement` per usage record with duration, tokens, cost, tool calls, provider, model, stage, role | `src/application/projections/metrics-read-adapter.ts:365` (`usageRecordToRun`), `"SC2/SC3: every outcome carries one AgentRunMeasurement per usage record"` | PASS |
| SC3: no returned outcome has `runs: []` | `src/application/projections/metrics-read-adapter.ts:227`, `test/task-2347.05-cycle-time-vs-runtime.test.ts:162` (`outcomes.every((o) => o.runs.length > 0)`) | PASS |
| SC4: `medianStateTimes` derives its median from lifecycle-derived cycle time | `src/application/projections/metrics.ts:119`, `"SC4: medianStateTimes reports the lifecycle cycle time"` | PASS |
| SC5: board renders two quantities under non-overlapping labels; no UI string calls execution minutes "cycle time" | `src/interfaces/tui/flow-panel.tsx:68`, `src/interfaces/tui/flow-panel.tsx:70`, `"SC5: FLOW panel labels lifecycle cycle time and agent runtime distinctly"` | PASS |
| SC5: the two labels report genuinely different numbers | `"SC5: the board exposes agent runtime separately from cycle time"` (1560 min lifecycle vs 37 min runtime) | PASS |
| SC6: `CompletedMissionStatistics` still sums runtime from `outcome.runs` via `totalDurationMinutes`, unchanged | `src/domain/usage.ts:181`, `"SC6: CompletedMissionStatistics still sums runtime from outcome.runs"` | PASS |
| SC7: verification gate passes on the final tree | `./scripts/verify-local.sh all` — exit 0, `ℹ tests 1853`, `ℹ fail 0` | PASS |
| Mixed-clock lifecycle windows cannot invert | `src/application/projections/metrics-read-adapter.ts:219`, `"SC2: a lane history with no closure event does not produce an inverted span"` | PASS |
| Repository scoping guarantee from task-2347.01 still holds under the new semantics | `test/task-2347-01-repository-identity-repro.test.ts:129`, `"metrics built for alpha exclude lane events recorded for beta"` | PASS |
| No focused or bare-skipped tests introduced | `test/task-2347.05-cycle-time-vs-runtime.test.ts` contains no `.only` and no `.skip` | PASS |
| Docs record the user-facing distinction | `docs/tui-board.md:64`, `docs/tui-board.md:92` (`agent runtime` source row) | PASS |
| Lint and types clean on every changed file | `npm run typecheck` — no output; `npx eslint src/application/projections/metrics-read-adapter.ts src/application/projections/metrics.ts src/application/projections/board.ts src/interfaces/tui/flow-panel.tsx test/task-2347.05-cycle-time-vs-runtime.test.ts` — no output | PASS |

Next action: hand off the committed fixture cleanup for the next formal review decision.
