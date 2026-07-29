# CP-3 — Final verification

Ran the declared full-tree verification gate successfully and validated the
unchanged piped `px ui` rendering path. The headless command reported one
occurrence of each lane header: BACKLOG=1, REFINED=1, ACTIVE=1, REVIEW=1,
INTEGRATION=1, DONE=1.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Stable initial render has one visible board frame | `test/task-2313-repro.test.ts:107`, `"writes exactly one board frame for the first render"` | PASS |
| Exactly one board resize subscription is active | `src/interfaces/tui/shell.tsx:103`, `src/interfaces/tui/shell.tsx:264`, `src/interfaces/tui/board-layout.tsx:142`; `"subscribes to terminal resize exactly once across the component tree"` | PASS |
| Resized final frame has one of every lane header | `test/task-2313-repro.test.ts:149`, `"shows every lane header exactly once in the final frame after a resize"` | PASS |
| Piped headless UI has one of every lane header | `src/interfaces/tui/ui-command.ts:138`; `tsx --import ./src/entry/esm-globals.ts src/entry/px.ts ui` | PASS (BACKLOG=1, REFINED=1, ACTIVE=1, REVIEW=1, INTEGRATION=1, DONE=1) |
| Existing TUI component tests pass without modification | `test/tui-shell-component.test.ts`, `test/tui-responsive-layout.test.ts`, `test/tui-lane-columns.test.ts`, `test/tui-wave-3-component.test.ts`, `test/tui-wave-4-attention.test.ts`, `test/tui-headless-isolation.test.ts`; `./scripts/verify-local.sh all` | PASS |
| Mission-declared full verification gate passes | `./scripts/verify-local.sh all` | PASS |

Next action: Hand the committed mission to Parallix for its lifecycle-managed review transition.
