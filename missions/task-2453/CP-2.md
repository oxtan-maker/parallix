# CP-2: Shared in-progress rendering

Changed the web fan to use the existing non-stale current-work rule. Pending
actions retain `starting…` until the refreshed current-work projection reports
active work, then render `working…`; Ink already consumes that same fact with
`agentIsWorking`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: unverified integrate work spins | `test/task-2453-repro.test.ts`, `"TASK-2453 SC1: an unverified integrate fact spins the web fan"`; `npm test -- --unit-test-headroom test/task-2453-repro.test.ts` | PASS |
| SC2: web spins only for in-progress work | `web/src/format.ts`; `src/application/projections/current-work.ts` `isWorkInProgress` | Live/unverified implemented; CP-3 coverage pending |
| SC3: pending action distinguishes start from running | `test/task-2453-repro.test.ts`, `"TASK-2453 SC3: a pending action changes from starting to working with current-work"` | PASS |
| SC4: Ink and web share live-work projection | `src/application/projections/mission-board.ts` `agentIsWorking`; `web/src/format.ts` | Implemented; CP-3 coverage pending |
| SC5: final repository verification | `./scripts/verify-local.sh all` | Pending CP-4 |

Next action: add explicit cleared/stale web cases and prove the matching Ink projection for live and unverified facts.
