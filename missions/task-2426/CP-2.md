# CP-2 — Wire instance capabilities to Mission authority

Production composition now creates the existing Mission services from its injected store and supplies those exact service instances to the shared and factory-built board controllers. The controller owns `canExecute`; TUI availability composes that query with workflow eligibility.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 red reproduction is green after service wiring | `test/task-2426-repro.test.ts`, `"wired production controller dispatches mission intake and factory agrees"`, `npx tsx --test test/task-2426-repro.test.ts` | PASS |
| SC3 instance query reflects the wired graph and absent services | `test/task-2426-repro.test.ts`, `"read-only production controller does not advertise Mission commands"` | PASS |
| SC4 TUI runnability composes the dispatcher query with workflow eligibility | `src/interfaces/tui/action-bar.tsx`, `test/tui-action-bar.test.ts` | PASS |
| SC5 unimplemented kinds remain unavailable on both graphs | `test/task-2426-repro.test.ts`, `"wired production controller dispatches mission intake and factory agrees"` | PASS |
| SC6 existing TUI command behavior remains covered | `test/tui-command-flow.test.ts`, `npx tsx --test test/task-2426-repro.test.ts test/tui-action-bar.test.ts test/tui-command-flow.test.ts` | PASS |

Next action: Exercise the real production entry point through intake, checkpoint, and handoff, then run both mission gates.
