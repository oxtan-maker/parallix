# CP-2: Responsive board layout, resize handling, and BoardShell refactor

## Summary of work done

- **`src/interfaces/tui/board-layout.tsx`** — new `BoardLayout` renders the six
  `BoardStage`s as `LaneColumn`s and picks the arrangement from terminal width:
  `row` (six equal columns) at ≥ `WIDE_LAYOUT_MIN_COLUMNS` (100), `column` (stacked)
  below it. `laneWidth()` divides the board width across the six lanes, and
  `visibleCardsForHeight()` adapts the per-lane card budget to terminal *height* so a
  busy lane cannot push the board past the last row — height adaptation is part of the
  same responsive requirement as width. `columns`/`rows`/`mode` props let a caller
  drive an exact size; without them the live terminal size is used.
- **`useTerminalDimensions()`** — the resize hook. Ink 6.8.0 exports no
  `useWindowDimensions` (see the CP-1 deviation note), so the hook reads `columns`/`rows`
  from the stdout stream Ink renders to (`useStdout()`) and subscribes to that stream's
  `resize` event — the same signal Ink's own renderer listens to. It returns the previous
  object when a resize does not actually change the size, so a no-op event costs no
  re-render.
- **`BoardShell` refactored** — the shell no longer contains lane or card rendering. Its
  former `LaneHeader`, `Card`, `getStage`, `getCount`, `isInFlight`,
  `isPlaceholderTitle`, `getCardBorderColor`, and `getAgentColor` helpers are gone
  (115 lines removed); it now composes `BoardLayout` and keeps only wave-1 chrome: top
  bar, attention rail, command log, and footer. The shell is itself responsive: the rail
  sits beside the board when wide and above it when narrow, and it reserves `RAIL_WIDTH`
  before handing the remaining width to `BoardLayout`.
- **`MissionCard` line composition** — each fact slot is now composed into one string and
  truncated to the card width before rendering. Rendering the slots as separate `Text`
  children let Yoga shrink each child independently in a 12-column lane, splitting
  `task-0001 · unavailable` into `task- ·unavai` / `001 lable` across lines. Composing
  first means a wide six-column board degrades to `▍task-0001 …` instead of corrupting.
- **`test/tui-responsive-layout.test.ts`** — 10 tests. Layout selection is asserted from
  rendered geometry (six headers on one line vs. six successive lines), never from a mode
  label, so the assertions fail if the arrangement regresses.

The resize test drives a real `ink.render()` against a `FakeStdout` and emits that
stream's `resize` event. If `useTerminalDimensions` were removed, Ink would still
recompute its own layout but the component would keep the old width and stay in the wide
arrangement — the test fails. Ink's renderer clears the screen when width *decreases*,
which is what keeps a shrink from leaving a duplicated frame behind.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3: wide layout at 120 columns puts all six lane headers side by side | `src/interfaces/tui/board-layout.tsx:146` (row/column switch), test `"renders all six lane headers side by side at width 120"` in `test/tui-responsive-layout.test.ts` (BoardLayout in isolation) | PASS |
| SC3: BoardShell at effective breakpoint (136 total) shows six headers side by side | `src/interfaces/tui/shell.tsx:82` (mode from board area width), test `"renders six lane headers side by side at the effective wide breakpoint (136)"` in `test/tui-responsive-layout.test.ts` | PASS |
| SC3: narrow layout at 60 columns stacks the lanes vertically | `src/interfaces/tui/board-layout.tsx:39` (`selectLayoutMode`), test `"renders lanes in vertical sequence at width 60"` | PASS |
| SC3: the exact breakpoint width 99 selects the narrow layout | `src/interfaces/tui/board-layout.tsx:20` (`WIDE_LAYOUT_MIN_COLUMNS = 100`), tests `"selects the stacked layout at the exact breakpoint width 99"` and `"keeps the six columns side by side at the breakpoint width 100"` | PASS |
| SC3: BoardShell at 100 total columns stacks lanes (board area 64 < 100) | `src/interfaces/tui/shell.tsx:80` (boardWidth = width - RAIL_WIDTH - 2), test `"renders stacked lanes at 100 total columns"` in `test/tui-responsive-layout.test.ts` | PASS |
| SC4: a driven resize re-renders at the new dimensions | `src/interfaces/tui/board-layout.tsx:62`–`src/interfaces/tui/board-layout.tsx:85` (`useTerminalDimensions`, `stdout.on('resize', …)`), test `"reports the live terminal size and updates it on resize"` | PASS |
| SC4: after a 120→60 resize each lane header appears exactly once (no duplicated frame) | test `"re-renders at the new width with no duplicated lane headers"` in `test/tui-responsive-layout.test.ts` | PASS |
| SC4: resized output is within 10% of the narrow baseline (no truncated frame) | same test — ratio assertion against a fresh `renderToString` at 60 columns | PASS |
| Layout adapts to terminal height as well as width | `src/interfaces/tui/board-layout.tsx:102` (`visibleCardsForHeight`), `src/interfaces/tui/board-layout.tsx:160` (`maxVisibleCards` passed to `LaneColumn`) | PASS |
| Lane columns stay within their share of a wide terminal | `src/interfaces/tui/board-layout.tsx:91` (`laneWidth`), test `"keeps a lane column within its share of a wide terminal"` | PASS |
| `BoardShell` refactored onto `LaneColumn`/`MissionCard`; wave-1 chrome preserved | `src/interfaces/tui/shell.tsx:5` (import), `src/interfaces/tui/shell.tsx:123` (`BoardLayout` in the board area), `src/interfaces/tui/shell.tsx:112` (rail beside vs. above); wave-1 tests `"renders the top bar with \"px board\" label and repositoryId"`, `"renders attention rail with \"NEEDS YOU\" header"`, `"renders board column headers with WIP counts"` in `test/tui-shell-component.test.ts` still pass unchanged | PASS |
| BoardShell mode accounts for attention rail width | `src/interfaces/tui/shell.tsx:80`–`src/interfaces/tui/shell.tsx:86` (boardWidth + selectLayoutMode), `src/interfaces/tui/shell.tsx:126` (boardWidth passed to BoardLayout) | PASS |
| SC5 (partial): a lane column never wraps a card line into fragments | `src/interfaces/tui/mission-card.tsx:115`–`src/interfaces/tui/mission-card.tsx:127` (composed + truncated slot lines), test `"renders card slugs and lane counts in both layouts"` | PASS |
| SC6: import boundary holds for the new layout module | `src/interfaces/tui/board-layout.tsx:1`–`src/interfaces/tui/board-layout.tsx:5` (react, ink, projection types only); `npm test -- test/tui-import-boundary.test.ts` | PASS |
| SC8: headless isolation, spawn, and rollback tests remain green | `npm test -- test/tui-headless-isolation.test.ts test/tui-spawn.test.ts test/tui-rollback-proof.test.ts` — 29 pass / 0 fail together with the shell and lane-column suites | PASS |
| SC7: all layout assertions are on rendered text, not snapshots | `test/tui-responsive-layout.test.ts` (`headerLines` / `headerOccurrences` helpers) — 10 pass / 0 fail via `npm test -- test/tui-responsive-layout.test.ts` | PASS |
| Lint and typecheck clean | `./scripts/verify-local.sh static-analysis` — all four stages pass | PASS |

Next action: add the CP-3 truncation tests (a title over 80 characters must not appear
verbatim while an ellipsis does, and a 12-card lane must show `+N more` through the full
`BoardShell`), then run `./scripts/verify-local.sh all` and
`./scripts/verify-local.sh static-analysis` on the final tree for the mission gates.
