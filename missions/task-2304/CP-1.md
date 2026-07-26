# CP-1: LaneColumn and MissionCard components extracted with semantic tests

## Summary of work done

Extracted the two board-content components the wave-2 layout is built from, plus a
reusable projection fixture and a semantic test suite:

- **`src/interfaces/tui/mission-card.tsx`** — `MissionCard` renders the facts one
  `BoardProjection` mission card supplies: slug, title, agent, checkpoint, gate,
  next step, pull request, review approval, and blocking reason. Every fact slot is
  always rendered so an operator can distinguish "not blocked" from "we do not know";
  a fact that is `null`/absent renders the literal `unavailable` (`UNAVAILABLE`) rather
  than being derived in the component. `gate` keeps its projection values
  (`passed`/`failed`/`running`/`unknown`) and only renders `unavailable` when the fact
  itself is missing. A `truncate()` helper cuts over-long titles and next-step text at
  the card width with an ellipsis, deterministically rather than via Yoga-resolved
  `wrap`, so `renderToString` assertions are stable.
- **`src/interfaces/tui/lane-column.tsx`** — `LaneColumn` renders one `BoardStage`:
  a header carrying the lane label and the `wipCounts` value passed in, the card rows,
  an explicit empty-lane message that names the lane, and a `+N more` overflow
  indicator once a lane exceeds `DEFAULT_VISIBLE_CARDS` (8). Exports `BOARD_LANES` and
  `LANE_LABELS` for the layout work in CP-2.
- **`test/fixtures/board-projection.ts`** — plain-data builders (`makeCard`,
  `makeFullCard`, `makeCards`, `makeStage`, `makeProjection`) for mocked projections.
  No fixture reads a repository, launches an agent, or contacts Forgejo.
- **`test/tui-lane-columns.test.ts`** — 11 tests asserting rendered text content via
  `ink.renderToString` (no snapshots).

**Baseline repair (outside the component scope, but required to reach the gate):**
the build was red on arrival. `package-lock.json` listed `react-devtools-core` as a
root dependency that `package.json` never declared, so the installed tree lacked it
and `npm run bundle` failed with `Could not resolve "react-devtools-core"`. Ink only
imports it under `DEV=true`, from a dynamic import already guarded against
`ERR_MODULE_NOT_FOUND`, so it is now marked `external` in
`scripts/build-canonical-bundle.js:29` and the stale lock entry is dropped — lock and
`package.json` now agree, which is also what `npm ci` requires.

**Deviation from the mission text (flagged, not blocking):** the mission names Ink's
`useWindowDimensions` hook for CP-2, and a stop rule fires if it "cannot be imported".
Ink 6.8.0 does not export that hook at all (`node_modules/ink/build/index.d.ts` exports
`useStdout`, `useStdin`, `useApp`, `useFocus`, …). The stop rule's stated rationale —
"this blocks responsive layout entirely" — does not hold: Ink's `render()` already
listens for `stdout`'s `resize` event, and `useStdout()` exposes the same stream with
live `columns`/`rows`. CP-2 will therefore implement a local
`useTerminalDimensions()` hook over `useStdout()` + the `resize` event, which is the
supported equivalent in this Ink version. Nothing else in the wave-2 scope changes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: lane header renders lane name and the `wipCounts` value | `src/interfaces/tui/lane-column.tsx:65` (header row), test `"renders lane header with WIP count from the projection"` in `test/tui-lane-columns.test.ts` | PASS |
| SC1: each of the six lanes renders a header | `src/interfaces/tui/lane-column.tsx:17` (`LANE_LABELS`), test `"renders every lane header for all six lanes"` | PASS |
| SC1: empty lane renders an explicit message containing the lane name | `src/interfaces/tui/lane-column.tsx:30` (`emptyLaneMessage`), test `"renders an explicit empty-lane message naming the lane"` | PASS |
| SC2: card renders id, title, agent, checkpoint, gate, next step, PR, review approval, blocking reason | `src/interfaces/tui/mission-card.tsx:95`–`src/interfaces/tui/mission-card.tsx:143`, test `"renders every fact of a fully populated card"` | PASS |
| SC2: absent facts render `unavailable` instead of a derived value | `src/interfaces/tui/mission-card.tsx:14` (`UNAVAILABLE`), `src/interfaces/tui/mission-card.tsx:96`, test `"renders \"unavailable\" for every absent projection fact"` | PASS |
| SC2: gate renders the projection value, not a computed one | `src/interfaces/tui/mission-card.tsx:43` (`gateText`), test `"renders the projection gate value rather than deriving one"` | PASS |
| SC2: review approval is a visual indicator driven by `reviewApproved` | `src/interfaces/tui/mission-card.tsx:103`, test `"renders \"review pending\" when the projection reports no approval"` | PASS |
| SC2: blocking flag appears only when `blockingReason` is present | `src/interfaces/tui/mission-card.tsx:104` and `src/interfaces/tui/mission-card.tsx:140`, test `"omits the blocking flag when the projection reports no blocker"` | PASS |
| SC5 (partial): overflowing lane renders `+N more` rather than growing | `src/interfaces/tui/lane-column.tsx:27` (`DEFAULT_VISIBLE_CARDS`), test `"renders a \"+N more\" indicator for a lane with more cards than fit"` and `"renders no overflow indicator when every card fits"` | PASS |
| SC7: tests assert rendered text via `renderToString`, not snapshots | `test/tui-lane-columns.test.ts` (helpers `renderLaneColumn` / `renderMissionCard`), `npm test -- test/tui-lane-columns.test.ts` → 11 pass / 0 fail | PASS |
| SC6: new TUI files import only react, ink, and projection types | `src/interfaces/tui/lane-column.tsx:1`–`src/interfaces/tui/lane-column.tsx:5`, `src/interfaces/tui/mission-card.tsx:1`–`src/interfaces/tui/mission-card.tsx:3`; `npm test -- test/tui-import-boundary.test.ts` | PASS |
| Lint and typecheck clean on the new files | `./scripts/verify-local.sh static-analysis` — ESLint, `tsc`, test-hygiene, and test typecheck all report clean | PASS |
| Restricted areas untouched | `src/application/projections/board.ts`, `src/application/projections/mission-board.ts`, `src/platform/runtime/index.ts`, `src/interfaces/tui/ui-command.ts`, `test/tui-import-boundary.test.ts` absent from this checkpoint's `git show --stat` | PASS |

Next action: implement `src/interfaces/tui/board-layout.tsx` with a
`useTerminalDimensions()` hook over Ink 6.8.0's `useStdout()` + `resize` event, select
side-by-side at ≥ 100 columns and stacked below it, refactor `BoardShell` onto
`LaneColumn`, and add `test/tui-responsive-layout.test.ts` covering widths 120, 99, and
60 plus a driven 120→60 resize (CP-2).
