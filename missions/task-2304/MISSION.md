# Mission: Ink TUI wave 2 — lane columns, mission cards, and responsive terminal layout (task-2304)

## Goal

Render the six board lanes (backlog, refined, active, review, integration, done) as equal-width columns with `MissionCard` rows from `BoardProjection.stages`, and make the layout adapt to terminal width and height so that a wide terminal shows columns side-by-side, a narrow terminal falls back to a single-column stacked view, and a resize re-lays out without corrupting the screen.

## Why Now

Wave 1 (TASK-2282) delivered `px ui` as a static shell with identity, WIP counts, staleness indicators, the Ink runtime, build pipeline, and import-boundary guardrails. The shell component (`src/interfaces/tui/shell.tsx`) renders a fixed layout with an attention rail, grouped intake column, and three in-flight columns — but it does not yet render all six lanes as equal columns, does not handle responsive terminal sizes, and the card rendering is embedded in the shell rather than separated into reusable components. Wave 2 makes the board content operator-visible so that waves 3–6 (navigation, attention queue, actions, analytics) have a stable, readable board to build upon. Per ADR 0036 wave execution rules, wave 2 cannot begin until wave 1 is `done`.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: LaneColumn + MissionCard component extraction, responsive layout logic with Ink `useWindowDimensions`, resize re-render test, truncation behavior, and the semantic test suite at named widths

## Scope

- **LaneColumn component** (`src/interfaces/tui/lane-column.tsx`): renders a single lane header with lane name and WIP count, its `MissionCard` rows, and an explicit empty-lane message. Consumes one `BoardStage` from `BoardProjection.stages`.
- **MissionCard component** (`src/interfaces/tui/mission-card.tsx`): renders the card facts supplied by the projection — slug (`id`), title, agent, checkpoint, gate status, next step, review/PR indication, and blocking flag. Shows "unavailable" for absent sources instead of deriving a value in the component.
- **Responsive layout** (`src/interfaces/tui/board-layout.tsx` or integrated into `shell.tsx`): detects terminal width via Ink `useWindowDimensions` and selects between two layouts:
  - Wide (≥ 100 columns): six lanes side-by-side as equal-width columns.
  - Narrow (< 100 columns): single-column stacked view with lanes rendered vertically.
- **Terminal resize handling**: the layout re-renders when terminal dimensions change; no duplicated or truncated frames appear. A semantic test drives at least one resize event.
- **Truncation**: long titles truncate within the card area; overflowing lanes (many cards) show a "+N more" indicator rather than breaking the column height.
- **Refactor existing `BoardShell`** (`src/interfaces/tui/shell.tsx`) to use the new `LaneColumn` and `MissionCard` components for the six-lane rendering. The attention rail, top bar, command log, and footer from wave 1 are preserved.
- **Semantic test suite**: tests under `test/tui-lane-columns.test.ts` and `test/tui-responsive-layout.test.ts` that assert rendered text content (lane headers, card slugs, counts, empty messages) at named widths (wide, narrow, and the exact breakpoint).

## Out of Scope

- Keyboard navigation and selection (wave 3 / TASK-2305)
- Attention queue rendering (wave 4 / TASK-2306)
- Any action or command dispatch from the TUI (wave 5 / TASK-2307)
- Analytics and cycle-time panels (wave 6 / TASK-2308)
- Computing lifecycle state in the component — anything not on the `BoardProjection` is shown as "unavailable"
- Changes to `BoardProjection` or `MissionCard` types in `src/application/projections/` — the projection model is a wave-1 contract
- Changes to the headless CLI entry path (`src/platform/runtime/index.ts`) or `ui-command.ts`

## Success Criteria

- SC1: All six lanes (`backlog`, `refined`, `active`, `review`, `integration`, `done`) render from `BoardProjection.stages`; per-lane WIP counts in the rendered lane headers match `BoardProjection.wipCounts`; each lane with zero cards renders an explicit empty-lane message (text containing the lane name).
- SC2: `MissionCard` renders these projection fields: `id` (slug), `title`, `agent`, `checkpoint`, `gate` (as passed/failed/running/unknown), `nextActionText`, `pullRequest` (PR number when present), `reviewApproved` (visual indicator), `blockingReason` (red flag when present). For any field that is null/absent on the projection, the card renders "unavailable" text rather than computing a value.
- SC3: Semantic test at width 120 columns asserts six-lane side-by-side layout (all six lane headers appear on the same or adjacent lines in the Ink output). Semantic test at width 60 columns asserts single-column stacked layout (lanes appear in vertical sequence). Test at the exact breakpoint width (99 columns) asserts the narrow layout is selected.
- SC4: A resize test changes terminal width from 120 to 60 and asserts the re-rendered output contains no duplicated lane headers (each lane header appears exactly once) and no truncated frame artifacts (output length is within 10% of the expected narrow-layout baseline).
- SC5: A test with a card whose title exceeds 80 characters asserts the title is truncated in the rendered output (the full title string does not appear verbatim; a truncated version with "…" or ellipsis appears). A test with 12 cards in one lane asserts the "+N more" overflow indicator appears.
- SC6: No `src/interfaces/tui/` file imports `node:fs`, `node:child_process`, `git`, `sqlite`, or any workflow/adapter module. Verified by the existing `tui-import-boundary.test.ts` guardrail.
- SC7: Component tests use `ink.renderToString` and assert rendered text content (e.g., `output.includes("task-9999")`) rather than relying exclusively on snapshot comparisons.
- SC8: `tui-headless-isolation.test.ts` passes (headless entry module graph contains no react/ink), `tui-spawn.test.ts` passes, and the non-TTY Ink-isolation test passes — headless CLI output, exit codes, and isolation remain unchanged.
- SC9: `./scripts/verify-local.sh all` passes and `./scripts/verify-local.sh static-analysis` passes on the final tree.

## Risks and Assumptions

- **Ink resize behavior**: Ink's `useWindowDimensions` may emit rapid successive events during a drag-resize. Assumption: Ink batches or debounces internally; if not, the component must handle rapid re-renders without duplicating frames. Mitigation: measure with the resize test at CP 2.
- **Breakpoint tuning**: The 100-column threshold is an initial choice; different terminal fonts or emoji widths may shift the practical breakpoint. Assumption: the semantic tests at named widths expose any rendering breakage regardless of the exact threshold chosen.
- **BoardProjection stability**: Wave 1 established the `BoardProjection` type and its builder. Assumption: no wave-1 follow-up mission changes `BoardStage` or `MissionCard` shapes between waves. If the projection model changes, the TUI components adapt within this wave.
- **renderToString availability**: The wave-1 test suite uses `ink.renderToString` for synchronous testing. Assumption: this API remains stable in the installed Ink version.
- **Terminal color support**: Assumption: the test environment renders ANSI color codes consistently. Color-specific assertions are avoided in favor of text-content assertions.

## Checkpoints

- CP 1: Extract `LaneColumn` and `MissionCard` components with semantic tests. `LaneColumn` renders a lane header (name + count) and its card rows or an empty-lane message. `MissionCard` renders all projection fields including "unavailable" for absent sources. Tests use `ink.renderToString` with mocked `BoardProjection` data covering all six lanes, populated and empty states, and cards with every field present and absent.
- CP 2: Implement responsive layout with wide/narrow breakpoint and terminal resize handling. The layout component detects terminal width via `useWindowDimensions` and selects side-by-side (≥ 100 columns) or stacked (< 100 columns). Refactor `BoardShell` to use the new layout. Tests assert rendered semantics at widths 120 (wide), 60 (narrow), and 99 (breakpoint). A resize test drives width change and checks for no duplicated headers.
- CP 3: Add truncation for long titles, overflow indicators for large lanes, and finalize verification. Tests assert title truncation for titles > 80 characters and "+N more" for lanes with > 8 visible cards. Run full verification gate including `static-analysis` for changed `src/` code. Confirm headless CLI isolation tests remain green.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/interfaces/tui/lane-column.tsx:45` (must point to an existing file and line)
  2. **Test names** — e.g., `"renders all six lane headers at wide terminal width"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/tui-lane-columns.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `./scripts/verify-local.sh static-analysis` ``, or `` `npm test -- test/tui-lane-columns.test.ts` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| LaneColumn renders lane header with count | `src/interfaces/tui/lane-column.tsx:12`, test `"renders lane header with WIP count"` in `test/tui-lane-columns.test.ts` | PASS |
| MissionCard shows "unavailable" for absent gate | `src/interfaces/tui/mission-card.tsx:38`, test `"shows unavailable for absent gate"` in `test/tui-lane-columns.test.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas

- `src/application/projections/board.ts` — BoardProjection type is a wave-1 contract; do not add or remove fields
- `src/application/projections/mission-board.ts` — MissionCard type and `projectMissionCard` are wave-1 contracts; do not change the shape
- `src/platform/runtime/index.ts` — headless CLI entry path; changes require wave-1 owner approval
- `src/interfaces/tui/ui-command.ts` — UI command dispatch; unchanged in wave 2
- `test/tui-import-boundary.test.ts` — import guardrail test; do not modify (it must continue to enforce the boundary for new components)
- `test/tui-headless-isolation.test.ts` — headless isolation test; do not modify
- `test/tui-spawn.test.ts` — TUI spawn test; do not modify
- `test/tui-rollback-proof.test.ts` — rollback proof test; do not modify

## Stop Rules

- Stop if Ink's `useWindowDimensions` hook cannot be imported or does not fire on resize in the installed Ink version — this blocks responsive layout entirely.
- Stop if refactoring `BoardShell` to use separate `LaneColumn` and `MissionCard` components breaks the headless isolation test (`test/tui-headless-isolation.test.ts`) — the import boundary must not regress.
- Stop if the `renderToString` API from Ink is unavailable or produces unreliable output for semantic assertions — the test strategy depends on it.
- Stop if any wave-1 follow-up mission changes `BoardProjection.stages` or `MissionCard` types between waves, because the contract assumed by this wave would be invalidated.
- Do not add keyboard navigation, attention queue rendering, action dispatch, or analytics panels — these are explicitly deferred to waves 3–6.
- Do not compute lifecycle state or derive values in the component that are not already present on the `BoardProjection` — the projection is the single source.

## Design reference
- '/tmp/Parallix Kanban Board Controller.zip'

