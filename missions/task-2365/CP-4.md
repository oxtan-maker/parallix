# CP-4 — Real-agent cleanup and final verification

The real-agent fixture registers its repository and capture roots before use,
releases records after ordinary cleanup or explicit diagnostic retention, and
cleans registered roots on handled interruption and ordinary exit. The manifest
directory and records are owner-checked, private, and restricted to temporary
roots; raced records cannot abort verification. Focused helper coverage proves
failure, timeout, ordinary cleanup, opt-in retention, and no-residue behavior
without launching an agent. The required static-analysis gate and `npm test`
pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Recorded roots for all observed classes are reclaimable without prefix sweeping. | `test/task-2365-tmp-reclamation.test.ts` — "recorded dead roots are reclaimed while live and unrecorded roots survive" | Pass |
| Every temporary-root creator has an ownership or local-finally contract. | `src/adapters/verification/temp-root-registry.ts`; `test/helpers/temp-dir.ts`; `test/e2e-real-agent-smoke.test.ts` | Pass |
| Test runner, coverage gate, and wrappers clean before forwarding completion or handled signals. | `test/run-default-tests.ts`; `src/adapters/verification/coverage-gate.ts`; `test/task-2365-tmp-reclamation.test.ts` — "runner cleanup removes worker roots before forwarding child failure or a handled signal" and "runner preserves each child signal exit code after cleanup" | Pass |
| Later eligible runs recover only dead recorded owners. | `test/task-2365-tmp-reclamation.test.ts` — "recorded dead roots are reclaimed while live and unrecorded roots survive"; `test/task-2327-coverage-gate-tmp-leaks.test.ts` — "coverage-gate SIGKILL orphan recovery reclaims registered scratch roots", "recovery does not remove roots belonging to a live concurrent run", and "recovery does not remove unregistered directories with matching prefixes" | Pass |
| Real-agent roots retain opt-in diagnostics and clean otherwise. | `test/task-2241-tmp-cleanup-repro.test.ts` — "real-agent smoke capture retention is opt-in and never deletes operator or concurrent paths" and "real-agent smoke captures clean up after normal, command-failure, and timeout runs" | Pass |
| Representative verification leaves no new non-retained roots. | `npm test`; `npm test -- test/task-2241-tmp-cleanup-repro.test.ts test/task-2365-tmp-reclamation.test.ts`; `npm test -- test/task-2327-coverage-gate-tmp-leaks.test.ts` | Pass |
| Static analysis passes on the final tree. | `./scripts/verify-local.sh static-analysis` | Pass |

Next action: hand off the committed mission for the lifecycle controller’s review transition.
