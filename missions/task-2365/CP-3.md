# CP-3 — Manifest lifecycle and signal ordering

The runner now clears worker manifests and their recorded roots before it
returns a child failure or handled interrupt status. The coverage gate uses the
same durable manifest recovery routine and deletes its own record during
idempotent cleanup. Recovery accepts only a dead PID record; malformed records
grant no deletion authority.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Recorded roots for all observed classes are reclaimable without prefix sweeping. | `test/task-2365-tmp-reclamation.test.ts` — "recorded dead roots are reclaimed while live and unrecorded roots survive" | Pass |
| Every temporary-root creator has an ownership or local-finally contract. | `src/adapters/verification/temp-root-registry.ts`; `test/helpers/temp-dir.ts` | Pass |
| Test runner, coverage gate, and wrappers clean before forwarding completion or handled signals. | `test/run-default-tests.ts`; `src/adapters/verification/coverage-gate.ts`; `test/task-2365-tmp-reclamation.test.ts` — "runner cleanup removes worker roots before forwarding child failure or a handled signal" and "runner preserves each child signal exit code after cleanup" | Pass |
| Later eligible runs recover only dead recorded owners. | `test/task-2327-coverage-gate-tmp-leaks.test.ts` — "coverage-gate SIGKILL orphan recovery reclaims registered scratch roots" and "recovery does not remove roots belonging to a live concurrent run" | Pass |
| Real-agent roots retain opt-in diagnostics and clean otherwise. | `test/e2e-real-agent-smoke.test.ts` | Pending CP-4 focused check |
| Representative verification leaves no new non-retained roots. | `npm test -- test/task-2365-tmp-reclamation.test.ts test/coverage-gate.test.ts`; `npm test -- test/task-2327-coverage-gate-tmp-leaks.test.ts` | Pass (focused) |
| Static analysis passes on the final tree. | `./scripts/verify-local.sh static-analysis` | Pending CP-4 |

Next action: verify the real-agent helper’s diagnostic-retention path without launching an agent, then run the final static-analysis gate.
