# CP-1 — Red owner-scoped recovery regression

Added the reproduction test before implementation. It creates each observed
artifact class under a private fixture, records five roots for a simulated dead
owner, and proves recovery must preserve both a simulated live owner and an
unrecorded matching root. The test fails on the parent behavior because the
shared owner-scoped recovery module is absent.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Recorded roots for all observed classes are reclaimable without prefix sweeping. | `test/task-2365-tmp-reclamation.test.ts` — "recorded dead roots are reclaimed while live and unrecorded roots survive" | Red before implementation |
| Every temporary-root creator has an ownership or local-finally contract. | `test/helpers/temp-dir.ts`; `test/task-2365-tmp-reclamation.test.ts` | Pending CP-2 audit |
| Test runner, coverage gate, and wrappers clean before forwarding completion or handled signals. | `test/run-default-tests.ts`; `src/adapters/verification/coverage-gate.ts` | Pending CP-3 |
| Later eligible runs recover only dead recorded owners. | `test/task-2365-tmp-reclamation.test.ts` — "recorded dead roots are reclaimed while live and unrecorded roots survive" | Red before implementation |
| Real-agent roots retain opt-in diagnostics and clean otherwise. | `test/e2e-real-agent-smoke.test.ts` | Pending CP-4 |
| Representative verification leaves no new non-retained roots. | `npm test`; `npm run test:coverage` | Pending CP-4 |
| Static analysis passes on the final tree. | `./scripts/verify-local.sh static-analysis` | Pending CP-4 |

Next action: implement `recoverRecordedTempRoots` and make the runner and coverage gate record roots before child work.
