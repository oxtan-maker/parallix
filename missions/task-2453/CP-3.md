# CP-3: Cross-surface freshness coverage

Extended the regression at the shared projection boundary. It proves that web
fan rendering and Ink's `agentIsWorking` agree for live, unverified, stale,
and cleared current-work facts.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: unverified integrate work spins | `test/task-2453-repro.test.ts`, `"TASK-2453 SC1: an unverified integrate fact spins the web fan"` | PASS |
| SC2: web spins only for in-progress work | `test/task-2453-repro.test.ts`, `"TASK-2453 SC2/SC4: web and Ink agree on live-work freshness"`; `npm test -- --unit-test-headroom test/task-2453-repro.test.ts` | PASS |
| SC3: pending action distinguishes start from running | `test/task-2453-repro.test.ts`, `"TASK-2453 SC3: a pending action changes from starting to working with current-work"` | PASS |
| SC4: Ink and web share live-work projection | `test/task-2453-repro.test.ts`, `"TASK-2453 SC2/SC4: web and Ink agree on live-work freshness"`; `src/interfaces/tui/mission-card.tsx` | PASS |
| SC5: final repository verification | `./scripts/verify-local.sh all` | Pending CP-4 |

Next action: run `./scripts/verify-local.sh all` and record its successful result in CP-4.
