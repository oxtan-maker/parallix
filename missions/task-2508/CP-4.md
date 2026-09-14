# CP 4 — Authoritative status regression

Changed mission status output to render the BoardProjection card’s lifecycle `status`, not its legacy `rawStatus`. The regression seeds a done card with stale raw status `active` and verifies `px status` reports `done`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1–SC4 remain covered by the interrupted-landing regression | `test/task-2508-interrupted-landed-integration-repro.test.ts` | PASS |
| SC5 prints lifecycle done instead of stale backlog state | `test/task-2508-interrupted-landed-integration-repro.test.ts`, `"px status reports the authoritative done lifecycle"` | PASS |
| Status remains projection-backed | `src/adapters/cli/commands/status.ts`, `src/application/projections/mission-board.ts` | PASS |
| Focused regression suite passes | `node --import tsx test/task-2508-interrupted-landed-integration-repro.test.ts` | PASS |

Next action: Run the mission-declared verification gate and record its result.
