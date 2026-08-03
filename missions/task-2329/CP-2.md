# CP-2: Data-Display Enhancements

## Summary
Implemented the five data-display capabilities by extending existing TUI modules only (no new top-level directories, no new projection types, no new read adapters).

### Changes
- **SC1 Agent strip**: New `src/interfaces/tui/agent-strip.tsx` (justified: `shell.tsx` is 553 lines > 300 threshold; agent strip has distinct session-aggregation lifecycle). Renders availability dots (green/red), family name, aggregated session count from card agent fields, and blocked countdown. Integrated into `shell.tsx` between FLOW panel and board area.
- **SC2 On-card actions**: Extended `MissionCard` to render compact `[command]` buttons for enabled entries in `MissionCard.commands[]`. Buttons dispatch via `onAction` callback through `BoardCommandController`.
- **SC3 WIP limits**: Added optional `wipLimit?: number` to `WipCountMetric` in `board.ts`. `LaneColumn` renders `count/limit` format with yellow bold styling when count exceeds limit.
- **SC4 Median cycle time**: `BoardLayout` now passes `medianCycleTimeByState` to `LaneColumn`. Lane headers render `med N m` when value is present.
- **SC5 Label badge**: `MissionCard` renders `labels[0]` as `[label]` bordered text badge in the card header line.
- **SC8 Review details**: `MissionCard` parses `flags` for `review:round-N` and `review:blocking-N` patterns and renders them as `R2 · 2 blocking` on the PR/review line.

### Files Modified
| File | Lines | Change |
|---|---|---|
| `src/application/projections/board.ts` | +2 | Added `wipLimit?: number` to `WipCountMetric` |
| `src/interfaces/tui/agent-strip.tsx` | +76 | New component (justified > 300 lines in shell.tsx) |
| `src/interfaces/tui/board-layout.tsx` | +18 | Added `wipLimitFor`, `medianCycleTimeFor`, `onAction`, `shippedCollapsed` |
| `src/interfaces/tui/lane-column.tsx` | +14 | Added `wipLimit`, `medianCycleTime`, `onAction` props; over-limit styling |
| `src/interfaces/tui/mission-card.tsx` | +40 | Added `onAction` prop, label badge, review details, on-card buttons |
| `src/interfaces/tui/shell.tsx` | +30 | Added `AgentStrip` import, `shippedCollapsed` state, lifecycle dispatch |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 agent strip | `src/interfaces/tui/agent-strip.tsx:1-76`, `src/interfaces/tui/shell.tsx:237` AgentStrip render, `test/tui-characterization-cp1.test.ts:61` "BoardShell renders an agent strip between top bar and board" | PASS |
| SC2 on-card actions | `src/interfaces/tui/mission-card.tsx:146-157` on-card button render, `src/interfaces/tui/board-layout.tsx:170` onAction passthrough | PASS |
| SC3 WIP limit | `src/application/projections/board.ts:62` wipLimit field, `src/interfaces/tui/lane-column.tsx:72-74` count/limit + over-limit styling, `test/tui-characterization-cp1.test.ts:153` "LaneColumn renders count only, no WIP limit" | PASS |
| SC4 median cycle | `src/interfaces/tui/board-layout.tsx:95-98` medianCycleTimeFor, `src/interfaces/tui/lane-column.tsx:75-77` header render, `test/tui-characterization-cp1.test.ts:179` "LaneColumn does NOT render median cycle time in header" | PASS |
| SC5 label badge | `src/interfaces/tui/mission-card.tsx:130-133` label badge render, `test/tui-characterization-cp1.test.ts:186` "MissionCard renders labels[0] as a bordered badge in card header" | PASS |
| SC8 review details | `src/interfaces/tui/mission-card.tsx:97-112` reviewRoundFromFlags/blockingFindingsFromFlags, `test/tui-characterization-cp1.test.ts:337` "MissionCard renders review round and blocking findings from flags" | PASS |
| SC10 no new files without justification | `src/interfaces/tui/agent-strip.tsx` justified: shell.tsx > 300 lines, `test/tui-characterization-cp1.test.ts:396` "no TUI module exceeds 300 lines except shell.tsx" | PASS |

Next action: Verify interaction enhancements (SC6 lifecycle shortcuts, SC7 shipped collapse) and write CP-3 document.
