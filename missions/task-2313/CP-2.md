# CP-2 — Shared terminal dimensions

Made `BoardShell` the live terminal-dimension owner and passed its resolved
width and height to `BoardLayout`. `BoardLayout` retains standalone live sizing,
but disables its resize effect whenever both dimensions are supplied. The hook
also preserves its cached state object when the initial post-subscription read
matches the initial render.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| No redundant initial dimension state update | `src/interfaces/tui/board-layout.tsx:70`, `src/interfaces/tui/board-layout.tsx:81`; `"writes exactly one board frame for the first render"` | PASS |
| BoardShell is the only live board resize subscriber | `src/interfaces/tui/shell.tsx:103`, `src/interfaces/tui/shell.tsx:264`, `src/interfaces/tui/board-layout.tsx:142`; `"subscribes to terminal resize exactly once across the component tree"` | PASS |
| Resized final frame contains each of the six lane headers once | `test/task-2313-repro.test.ts:149`, `"shows every lane header exactly once in the final frame after a resize"` | PASS |
| Existing TUI component tests remain unchanged and pass | `test/tui-shell-component.test.ts`, `test/tui-responsive-layout.test.ts`, `test/tui-lane-columns.test.ts`, `test/tui-wave-3-component.test.ts`, `test/tui-wave-4-attention.test.ts`, `test/tui-headless-isolation.test.ts`; `npm test -- test/task-2313-repro.test.ts test/tui-responsive-layout.test.ts test/tui-shell-component.test.ts test/tui-lane-columns.test.ts test/tui-wave-3-component.test.ts test/tui-wave-4-attention.test.ts test/tui-headless-isolation.test.ts` | PASS (68 tests) |

Next action: Run the mission-wide verification gate and pipe the UI command to verify the unchanged headless renderer emits each lane header once.
