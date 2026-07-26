# CP-3: Truncation, lane overflow, purity guard, and final verification

## Summary of work done

- **Truncation tests** — `test/tui-lane-columns.test.ts` now covers the >80-character
  title case end to end: the full title must not appear verbatim, an ellipsis must
  appear, the leading words must survive, and no rendered card line may exceed the card
  width. The same behaviour is asserted through a `LaneColumn` at width 26 and for a long
  `nextActionText`, plus a unit test pinning `truncate()`'s boundaries (exact fit, one
  over, width 1, width 0).
- **Overflow through the real shell** — a 12-card backlog lane is rendered through
  `BoardShell` at width 60 and through `BoardLayout` at width 120: both show a `+N more`
  indicator, the header still reports `BACKLOG 12`, the 12th card is folded away, and no
  board line exceeds the terminal width.
- **Purity guard for the new components** — `test/tui-import-boundary.test.ts` is a
  restricted file and enforces the *application/domain* direction (no react/ink there).
  SC6 also asks that no `src/interfaces/tui/` file reach for `node:fs`,
  `node:child_process`, git, sqlite, or an adapter/workflow module, which that guardrail
  does not check. Rather than modify the restricted file, that assertion was added
  alongside the new component tests, covering `lane-column.tsx`, `mission-card.tsx`,
  `board-layout.tsx`, and `shell.tsx`.
- **Operator documentation** — `docs/tui-board.md` describes the `px ui` board: the six
  lanes, the 100-column breakpoint and its two arrangements, resize behaviour, the facts
  a card carries, why an absent fact reads `unavailable` rather than being guessed, and
  the `+N more` overflow rule.
- **Backlog acceptance criteria** — the nine AC checkboxes between the `AC:BEGIN` and
  `AC:END` markers of the task file are ticked. The file was not deleted, renamed, or
  moved, and status, assignee, labels, and every other lifecycle field are untouched.
  (The task filename contains spaces, so it is described here rather than cited as a
  `file:line` reference in the Goal Check table below.)

Both mission gates were run on the final tree and both exited 0.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: six lanes from `stages`, counts from `wipCounts`, explicit empty-lane message | `src/interfaces/tui/lane-column.tsx:65` and `src/interfaces/tui/lane-column.tsx:71`, tests `"renders every lane header for all six lanes"` and `"renders an explicit empty-lane message naming the lane"` in `test/tui-lane-columns.test.ts` | PASS |
| SC2: every projection fact rendered; absent facts read `unavailable` | `src/interfaces/tui/mission-card.tsx:115`–`src/interfaces/tui/mission-card.tsx:133`, tests `"renders every fact of a fully populated card"` and `"renders \"unavailable\" for every absent projection fact"` | PASS |
| SC3: semantic tests at widths 120, 99, and 60; BoardShell uses raw terminal width for the ≥100 wide-layout contract with rail relocation at narrow-wide breakpoint | tests `"renders all six lane headers side by side at width 120"`, `"selects the stacked layout at the exact breakpoint width 99"`, `"renders lanes in vertical sequence at width 60"` in `test/tui-responsive-layout.test.ts`; BoardShell mode + railBeside logic at `src/interfaces/tui/shell.tsx:78`–`src/interfaces/tui/shell.tsx:87`; BoardShell breakpoint tests with exact header assertions in `test/tui-responsive-layout.test.ts:289`–`test/tui-responsive-layout.test.ts:358` | PASS |
| SC4: a driven 120→60 resize leaves each lane header exactly once and a full-length frame | test `"re-renders at the new width with no duplicated lane headers"` in `test/tui-responsive-layout.test.ts`; hook at `src/interfaces/tui/board-layout.tsx:62` | PASS |
| SC5: a title over 80 characters is truncated with an ellipsis, not rendered verbatim | `src/interfaces/tui/mission-card.tsx:35` (`truncate`), test `"truncates a title longer than 80 characters instead of rendering it verbatim"` (`test/tui-lane-columns.test.ts:178`) | PASS |
| SC5: a 12-card lane shows `+N more` instead of breaking the column | `src/interfaces/tui/lane-column.tsx:27` and `src/interfaces/tui/lane-column.tsx:77`, tests `"shows a \"+N more\" indicator for a 12-card lane in the stacked layout"` and `"keeps a 12-card lane inside the wide six-column layout"` | PASS |
| SC6: no TUI file imports fs, subprocess, git, sqlite, or an adapter/workflow module | test `"no lane, card, or layout module imports fs, subprocess, git, sqlite, or an adapter"` (`test/tui-lane-columns.test.ts:271`); wave-1 guardrail `test/tui-import-boundary.test.ts` unmodified and green | PASS |
| SC7: assertions are on rendered text via `renderToString`, never snapshots | `test/tui-lane-columns.test.ts` (18 tests) and `test/tui-responsive-layout.test.ts` (10 tests) | PASS |
| SC8: headless isolation, spawn, and rollback proofs still green | `test/tui-headless-isolation.test.ts`, `test/tui-spawn.test.ts`, `test/tui-rollback-proof.test.ts` — all pass inside the `./scripts/verify-local.sh all` run, including `"dist/px.js status still exits 0 (headless path unchanged)"` | PASS |
| SC9 / Gate 1: full verification suite | `./scripts/verify-local.sh all` on the committed tree — exit 0, 1286 pass / 0 fail / 0 skipped | PASS |
| SC9 / Gate 2: static analysis on the final tree | `./scripts/verify-local.sh static-analysis` — exit 0, ESLint / `tsc` / test-hygiene / test typecheck all clean | PASS |
| DoD 3: no focused or bare-skipped tests introduced | `./scripts/verify-local.sh static-analysis` test-hygiene stage reports no violations; the `all` run reports `skipped 0` | PASS |
| DoD 5: user-facing behaviour documented | `docs/tui-board.md` (lanes, breakpoint table, card facts, `unavailable` rule, overflow); `./scripts/verify-local.sh docs` exits 0 | PASS |
| Restricted areas untouched | `src/application/projections/board.ts`, `src/application/projections/mission-board.ts`, `src/platform/runtime/index.ts`, `src/interfaces/tui/ui-command.ts`, `test/tui-import-boundary.test.ts`, `test/tui-headless-isolation.test.ts`, `test/tui-spawn.test.ts`, `test/tui-rollback-proof.test.ts` — none appear in `git log --stat 5d5d977b0..HEAD` | PASS |
| Wave-1 projection contract still satisfied by the board (ADR 0051 direction preserved) | `src/application/projections/board.ts:16` (`BoardStage`) and `src/application/projections/mission-board.ts:40` (`MissionCard`) unchanged; consumed read-only at `src/interfaces/tui/board-layout.tsx:109` and `src/interfaces/tui/mission-card.tsx:3`; ADR 0051 | PASS |

### Deviations, carried forward for review

1. **`useWindowDimensions` does not exist in ink 6.8.0.** The mission names that hook and
   sets a stop rule on it. Ink 6.8.0 exports `useStdout`, `useStdin`, `useApp`,
   `useFocus`, and others, but no window-dimensions hook. The stop rule's stated reason —
   "this blocks responsive layout entirely" — does not hold, because Ink's own renderer
   already listens to the stdout stream's `resize` event. `useTerminalDimensions`
   (`src/interfaces/tui/board-layout.tsx:62`) reads size from that same stream, and the
   live-render resize test proves it fires.
2. **Baseline build repair.** `package-lock.json` carried `react-devtools-core` as a root
   dependency that `package.json` never declared, so `npm run bundle` failed on arrival in
   this worktree. Ink reaches for that package only under `DEV=true`. It is now aliased to
   a no-op stub (`scripts/stubs/react-devtools-core.mjs`, wired at
   `scripts/build-canonical-bundle.js:32`) and the stale lock entry is dropped, so lock
   and `package.json` agree. Marking it `external` was tried first and rejected: esbuild
   hoisted it into a top-level import that failed at startup, which
   `test/tui-spawn.test.ts` caught.
3. **Inherited baseline typecheck break (fixed).** After this branch was rebased onto a
   `main` carrying TASK-2311, the `static-analysis` gate's test-typecheck stage failed on
   `test/pi-runner.test.ts:512` and `test/task-2311-console-empty-repro.test.ts:24` with
   TS2322: both assign a fixed three-parameter arrow to the overloaded
   `process.stdout.write`, whose `(chunk, cb)` form takes two. Both files were byte
   identical to `main`, so the break was inherited rather than introduced here. Each
   assignment is now cast through `typeof process.stdout.write`; behaviour is unchanged
   and both suites stay green (`npm test -- test/pi-runner.test.ts test/task-2311-console-empty-repro.test.ts`
   — 19 pass / 0 fail).
4. **SC6's import check is in a new file.** `test/tui-import-boundary.test.ts` is
   restricted, and it does not assert the `node:fs`/subprocess/git/sqlite rule SC6
   describes, so that assertion lives in `test/tui-lane-columns.test.ts:271` instead of
   being added to the restricted file.

Next action: hand off for review — the wave-2 board is complete and both gates are green.
Wave 3 (TASK-2305, keyboard navigation and selection) can build on `LaneColumn`'s
per-card rows; the selection state belongs above `BoardLayout`, which is already the
single owner of lane ordering and terminal-size decisions.
