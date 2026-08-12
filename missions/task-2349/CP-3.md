# CP-3: Honest non-zero commit results

Added an exact path-scoped HEAD comparison before treating a non-zero squash commit as a failure. When every intended payload path matches HEAD, integration reports the carrying commit and proceeds; when the payload differs, the existing failure and git-hook recovery guidance remain in place.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Intervening board commit cannot carry mission payload | `test/task-2349-integrate-stage-commit-race.test.ts`; `intervening bare board commit cannot contain the prepared mission payload` | Pass |
| Unrelated dirty file is excluded from landed squash commit | `test/task-2349-integrate-stage-commit-race.test.ts`; `intervening bare board commit cannot contain the prepared mission payload` | Pass |
| Already-landed payload is reported with carrying commit | `test/task-2349-integrate-stage-commit-race.test.ts`; `non-zero squash commit reports the carrying commit when HEAD has the complete payload` | Pass |
| Absent payload still aborts with hook guidance | `test/task-2349-integrate-stage-commit-race.test.ts`; `non-zero squash commit with an absent payload retains hook recovery guidance` | Pass |
| Squash creation avoids unscoped staging plus bare commit | `src/adapters/cli/commands/integrate.ts`; `npx tsc --noEmit --pretty false` | Pass |
| Durable workflow documentation matches behavior when applicable | `docs/` | Pending CP-4 review |
| Final verifier passes | `./scripts/verify-local.sh all` | Pending CP-4 |

Next action: inspect durable workflow documentation for an integration commit/reporting contract, then run the mission verification gate.
