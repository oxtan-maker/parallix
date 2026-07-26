# CP-1 — Wave 2 mapping and navigation contract

Mapped the current Ink board: `BoardShell` owns stdin and passes a `BoardProjection` into `BoardLayout`; `LaneColumn` currently clips at the first visible cards; `MissionCard` renders projection facts only. The shared `projectMissionDetail()` function is a pure application projection and has no existing UI call site.

Navigation contract for CP-2:

- Selection is `selectedMissionId` plus a per-lane visible-window start, held only in the TUI component tree.
- `ArrowUp`/`k` and `ArrowDown`/`j` move within a populated lane and stop at its boundary. The visible window shifts just enough to keep the selected card visible.
- `ArrowLeft`/`h` and `ArrowRight`/`l` move to the nearest populated lane in that direction, wrapping from the first lane to the last and vice versa; empty lanes are skipped. The destination selects the card at the previous row when present, otherwise its last card.
- An all-empty board has no selection. A board with cards initializes selection to the first card in board order.
- `enter`, `a`, `r`, and `c` are reserved future-action keys. They render an explicit unavailable message and have no command handler.
- The TUI receives mission-detail projections as data from its composition root. A missing detail, or stale/unavailable source fact, is rendered explicitly and does not cause the TUI to query an adapter.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Navigation has a defined lane/card, empty-lane, boundary, wrap, and window model | `src/interfaces/tui/shell.tsx:85`, `src/interfaces/tui/lane-column.tsx:42` | MAPPED |
| Wide and narrow layout focus integration point is identified | `src/interfaces/tui/board-layout.tsx:112`, `src/interfaces/tui/mission-card.tsx:90` | MAPPED |
| Mission detail uses the existing application projection boundary | `src/application/projections/mission-detail.ts:22`, `src/application/projections/create-board-projection-builder.ts:44` | MAPPED |
| Navigation remains separate from board commands and workflow execution | `src/interfaces/tui/shell.tsx:231`, `src/application/projections/board.ts:45` | MAPPED |
| Headless and non-TTY compatibility coverage is located | `test/tui-headless-isolation.test.ts`, `test/tui-spawn.test.ts` | MAPPED |
| Real-terminal smoke harness has no existing dependency to reuse | `package.json`, `test/tui-responsive-layout.test.ts:75` | MAPPED |

Next action: implement the pure navigation/window reducer, pass selection through the Ink layout, and add semantic component tests before wiring the real PTY harness.
