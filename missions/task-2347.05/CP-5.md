# CP-5: Board labels separated

## Summary

FLOW now renders both quantities, each under a label the other cannot be
mistaken for (`src/interfaces/tui/flow-panel.tsx:68`–`:71`):

- `Median lifecycle cycle time: <n> min (n=<sample>)` from
  `metrics.medianStateTimes`
- `Median agent runtime: <n> min (n=<sample>)` from
  `metrics.medianAgentRuntime`

Each carries its own `history: <fallback>` line, matching the panel's existing
convention that every value states how it degrades when history is missing.
Both series are read with optional chaining
(`src/interfaces/tui/flow-panel.tsx:51`–`:52`) because a projection cached
before the split has no runtime series; such a projection renders `unavailable`
rather than crashing the board, mirroring the existing `provenance?` guard.

The rows sit in FLOW's first column. Placing them beside the lane tables made
Ink's flex layout squeeze the READ column until the bottleneck sentence wrapped
mid-clause, which broke a pre-existing assertion in
`test/tui-flow-panel.test.ts`. Moving them left keeps every existing FLOW line
rendering exactly as before at 120 columns.

**Audit of remaining "cycle time" strings.** Two survive, and neither describes
agent execution minutes:

- `Median cycle time` in FLOW (`src/interfaces/tui/flow-panel.tsx:74`) labels
  `medianCycleTimeByState`, per-lane dwell time computed from closed lane
  intervals (`src/application/projections/metrics.ts:343`) — a lifecycle
  quantity.
- `med <n>m` in the lane-column header
  (`src/interfaces/tui/lane-column.tsx:86`) renders the same per-lane series via
  `medianCycleTimeFor` (`src/interfaces/tui/board-layout.tsx:120`).

No string presents `duration_minutes` under a cycle-time name; before this
mission, `Median cycle time` in FLOW was the only mission-level cycle-time
surface and it did not read the conflated value at all — the conflation reached
the board through `medianStateTimes`, which was previously not rendered.

**Docs.** `docs/tui-board.md:64` adds a section stating the two quantities and
the 37-minutes-vs-26-hours example, and the fact-source table gains an
`agent runtime` row naming `usage_statistics.duration_minutes` as its source
beside the existing `cycle time` row that names `board_lane_events`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5: board renders two distinct quantities under non-overlapping labels | `src/interfaces/tui/flow-panel.tsx:68`, `src/interfaces/tui/flow-panel.tsx:70`, `"SC5: FLOW panel labels lifecycle cycle time and agent runtime distinctly"` | PASS |
| SC5: the runtime label carries no "cycle time" wording | `test/task-2347.05-cycle-time-vs-runtime.test.ts:235` (asserts `!/cycle time/i` on the rendered runtime line) | PASS |
| Rendered values differ, so the labels are not two names for one number | `"SC5: the board exposes agent runtime separately from cycle time"` (1560 min vs 37 min) | PASS |
| Remaining "cycle time" strings describe lane dwell time, not execution minutes | `src/interfaces/tui/flow-panel.tsx:74`, `src/application/projections/metrics.ts:343` (`medianCycleTimeByStateSeries` reads lane intervals), `src/interfaces/tui/lane-column.tsx:86` | PASS |
| Projections cached before the split still render | `src/interfaces/tui/flow-panel.tsx:52` (optional chaining), `"FLOW panel states every fallback and survives a zero-history projection"` | PASS |
| Pre-existing FLOW rendering assertions unchanged and passing | `test/tui-flow-panel.test.ts`, `test/tui-characterization-cp1.test.ts` — 0 failures | PASS |
| Docs record the user-facing distinction | `docs/tui-board.md:64`, `docs/tui-board.md:68`, `docs/tui-board.md:70` | PASS |
| Lint clean on changed UI file | `npx eslint src/interfaces/tui/flow-panel.tsx` — no output | PASS |

Next action: CP-6 — run `./scripts/verify-local.sh all` on the committed tree and record SC1–SC7 evidence in the final Goal Check.
