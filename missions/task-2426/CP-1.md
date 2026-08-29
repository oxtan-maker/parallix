# CP-1 — Lock the production wiring mismatch

Added the isolated-SQLite reproduction using the real `composeProductionCapabilities` call shape. On the parent wiring it fails because `mission:intake` is advertised integrated but rejects as a capability error.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 red reproduction uses production composition and an isolated Mission store | `test/task-2426-repro.test.ts`, `"wired production controller dispatches mission intake"`, `npx tsx --test test/task-2426-repro.test.ts` | PASS (red failure confirmed) |
| No production behavior changed while locking the mismatch | `test/task-2426-repro.test.ts` | PASS |

Next action: Wire the three existing Mission services into both shared and factory-created board controllers, then make this repro green.
