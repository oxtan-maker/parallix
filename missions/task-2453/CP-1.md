# CP-1: Red unverified-integrate fan regression

Added the deterministic web-projection regression for an active `integrate`
current-work fact with `unverified` freshness. It is red before the production
rendering fix: the fact reaches the web card but its fan remains still.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: unverified integrate work spins | `test/task-2453-repro.test.ts`; `npm test -- test/task-2453-repro.test.ts` fails at `TASK-2453 SC1: an unverified integrate fact spins the web fan` before the fix | Red confirmed |
| SC2: web spins only for in-progress work | `web/src/format.ts`; `test/task-2453-repro.test.ts` | Pending CP-2/3 |
| SC3: pending action distinguishes start from running | `web/src/action-button.tsx` | Pending CP-2 |
| SC4: Ink and web share live-work projection | `src/application/projections/current-work.ts`; `src/interfaces/tui/mission-card.tsx` | Pending CP-2/3 |
| SC5: final repository verification | `./scripts/verify-local.sh all` | Pending CP-4 |

Next action: trace the existing action lifecycle signal and update the shared in-progress rendering with the smallest production change.
