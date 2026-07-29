# Mission: Fix TUI corruption — duplicate render frames in px ui (task-2313)

## Goal

Eliminate the visual corruption in the `px ui` terminal board where the UI renders two overlapping frames at different widths (a wide frame followed by a narrower frame below it), so that `tsx --import ./src/entry/esm-globals.ts src/entry/px.ts ui` produces a single clean frame that updates correctly on terminal resize without ghost content.

## Why Now

The `px ui` board is the primary operator interface for mission workflow. The corruption (duplicate frames at mismatched widths) makes the board unreadable after a while of use, undermining the operator's ability to track WIP, attention items, and lane states. This blocks the value of ADR 0051's UI-neutral application boundary because the Ink rendering layer itself produces unreliable output. The bug is rooted in `useTerminalDimensions()` being called independently in both `BoardShell` and `BoardLayout`, each subscribing to `stdout.on('resize')` and triggering cascading re-renders that Ink cannot fully overwrite before the next frame arrives.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: deduplicate terminal dimension tracking across two Ink components; add regression test capturing all write frames during resize; no new dependencies or interfaces required

## Scope

- Fix `useTerminalDimensions()` in `src/interfaces/tui/board-layout.tsx` so that its `useEffect` does not emit an immediate redundant re-render when `onResize()` is called right after subscribing to `stdout.on('resize')`.
- Ensure `BoardShell` (`src/interfaces/tui/shell.tsx`) and `BoardLayout` (`src/interfaces/tui/board-layout.tsx`) share a single source of terminal dimensions to prevent two independent `resize` subscriptions from producing overlapping re-render frames.
- Add a regression reproduction test under `test/` that verifies Ink's write stream emits at most one visible frame per render cycle (no duplicated lane headers or doubled chrome) when the TUI is first rendered and when a resize event fires.
- Keep the existing `renderToString` headless path (`ui-command.ts:138`) and all existing component tests passing.

## Out of Scope

- Changing the Ink version or upgrading from `ink ^6.8.0`.
- Modifying the board projection model, lane columns, mission cards, attention rail, or FLOW panel rendering logic.
- Web board or browser-based rendering surfaces.
- The `px board` CLI text command (non-Ink output path).
- General performance tuning of re-render frequency beyond the corruption fix.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `useTerminalDimensions()` in `src/interfaces/tui/board-layout.tsx` does not trigger a state update during the first render cycle when `stdout.columns` and `stdout.rows` are already set on initial mount. Verified by the reproduction test asserting render count ≤ 1 for a stable terminal.
- SC2: `BoardLayout` receives terminal dimensions as props from `BoardShell` and does not independently call `useTerminalDimensions()` (or, if it does call the hook, the hook is a no-op when `columns`/`rows` props are provided). Verified by reading `src/interfaces/tui/board-layout.tsx` and confirming at most one active `stdout.on('resize')` subscription in the component tree.
- SC3: After a resize event, every lane header (BACKLOG, REFINED, ACTIVE, REVIEW, INTEGRATION, DONE) appears exactly once in the final frame written to stdout. Verified by `test/task-2313-repro.test.ts` asserting header count = 1 per lane in the last frame.
- SC4: The `renderToString` headless path in `src/interfaces/tui/ui-command.ts:138` continues to produce a single frame with no duplicated lane headers when `process.stdin.isTTY` is false. Verified by running `tsx --import ./src/entry/esm-globals.ts src/entry/px.ts ui` under a pipe and counting header occurrences.
- SC5: All existing TUI component tests (`test/tui-shell-component.test.ts`, `test/tui-responsive-layout.test.ts`, `test/tui-lane-columns.test.ts`, `test/tui-wave-3-component.test.ts`, `test/tui-wave-4-attention.test.ts`, `test/tui-headless-isolation.test.ts`) pass without modification.
- SC6: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions

- The corruption is caused by dual `useTerminalDimensions()` subscriptions (one in `BoardShell`, one in `BoardLayout`) producing overlapping re-render frames. If the root cause is elsewhere (e.g., Ink cursor positioning or ANSI escape handling), the fix scope may expand.
- `stdout.columns` and `stdout.rows` are reliably set on the first render when running in a real TTY. If they are `undefined` on first render, the hook's initial state uses fallback values (80×24) and the `onResize()` call in the effect produces the visible re-render. The fix must handle this case without introducing a visible flash.
- Ink 6.8's `render()` and `renderToString()` semantics are stable; no version upgrade is needed.
- The fix does not alter the `BoardShell` props interface (`BoardShellProps`), so callers outside the TUI tree are unaffected.

## Checkpoints

- CP 1: Author a failing reproduction test (`test/task-2313-repro.test.ts`) that drives a real Ink `render()` against a `FakeStdout` (same pattern as `test/tui-responsive-layout.test.ts`), captures all frames written to stdout, and asserts that lane headers appear exactly once in the final frame — both at initial render (no duplicate frame from the `onResize()` effect) and after a resize event. The test must fail (red) on the parent commit because the dual-subscription produces overlapping frames.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:

- A summary of work done in this checkpoint
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: `Criterion | Evidence | Status`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/interfaces/tui/board-layout.tsx:58` (must point to an existing file and line)
  2. **Test names** — e.g., `"re-renders at the new width with no duplicated lane headers"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2313-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/task-2313-repro.test.ts` ``, `` `tsx --import ./src/entry/esm-globals.ts src/entry/px.ts ui` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Repro test fails on parent commit | `test/task-2313-repro.test.ts`, `"BoardShell produces single frame at initial render"` | FAIL (red) |
| useTerminalDimensions deduplicated | `src/interfaces/tui/board-layout.tsx:58`, `src/interfaces/tui/shell.tsx:82` | PASS |
| Existing TUI tests pass | `` `npm test -- test/tui-responsive-layout.test.ts` `` | PASS |

- CP 2: Implement the fix. Deduplicate terminal dimension tracking so that `BoardShell` owns the single `useTerminalDimensions()` call and passes `columns`/`rows` to `BoardLayout` as props. If `BoardLayout` still calls the hook internally, make it a no-op when `columns`/`rows` props are explicitly provided. Ensure the `onResize()` call in the effect does not trigger a redundant re-render by comparing against the already-cached initial dimensions before calling `setDimensions`. Verify the reproduction test turns green.

- CP 3: Run the full verification gate (`./scripts/verify-local.sh all`), confirm all existing TUI tests pass, and validate the headless `renderToString` path produces a single frame. Record the final Goal Check table.

Reproduction-Test: test/task-2313-repro.test.ts

## Gates

- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- `src/domain/` — do not modify domain types or models.
- `src/application/projections/board.ts` — do not modify the BoardProjection model or build helpers.
- `src/application/projections/mission-board.ts` — do not modify MissionCard, BoardLane, or attention rank logic.
- `src/interfaces/tui/lane-column.tsx`, `src/interfaces/tui/mission-card.tsx`, `src/interfaces/tui/flow-panel.tsx` — do not modify rendering logic in these components.
- `src/interfaces/tui/ui-command.ts` — do not modify the `runUiCommand` function or the headless render path except to verify it is unaffected.
- `package.json` — do not add or change dependencies.
- `test/tui-shell-component.test.ts`, `test/tui-responsive-layout.test.ts`, `test/tui-lane-columns.test.ts`, `test/tui-wave-3-component.test.ts`, `test/tui-wave-4-attention.test.ts`, `test/tui-headless-isolation.test.ts` — do not modify existing tests; the fix must pass them as-is.

## Stop Rules

- Stop if the corruption is traced to Ink's cursor positioning or ANSI escape handling rather than dual `useTerminalDimensions()` subscriptions — escalate to a design decision before expanding scope.
- Stop if fixing the dual subscription requires changing the `BoardShellProps` interface in a breaking way (e.g., making `columns`/`rows` required). The fix must remain backward compatible.
- Stop if the reproduction test cannot be written to reliably detect the corruption (e.g., the `FakeStdout` pattern does not capture the overlapping frames). Use `ink.renderToString()` with explicit `columns` as a fallback.
- Stop if more than 235 net engineering lines are needed; re-scope to the minimal fix (deduplicate `useTerminalDimensions()` subscription) and defer broader improvements.
- Do not modify any file outside `src/interfaces/tui/board-layout.tsx`, `src/interfaces/tui/shell.tsx`, and `test/task-2313-repro.test.ts` unless a change is essential to the fix and justified in the checkpoint document.
