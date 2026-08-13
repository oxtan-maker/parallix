# CP-1: Extract auth and token helpers

Created `forgejo-auth.ts` as the focused auth/token/home helper module. It contains the fourteen mission-scoped exports and retains `derivedRepoCache` as module-local state. The module is 147 lines, within the checkpoint stop-rule limit.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Auth module exports all scoped helpers | `src/adapters/forgejo/forgejo-auth.ts` | PASS |
| Auth module remains within its extraction boundary | `wc -l src/adapters/forgejo/forgejo-auth.ts` → 147 | PASS |
| Auth module compiles standalone | `node --check src/adapters/forgejo/forgejo-auth.ts` | PASS |

Next action: Replace the duplicated implementations in `forgejo.ts` with re-exports, redirect `forgejo-api.ts` to the new settings helper, and run static analysis.
