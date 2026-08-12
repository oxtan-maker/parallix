# CP-2 — Temporary-root inventory and ownership contract

Audited `mkdtemp`/`mktemp` and direct temporary-root writes in the declared
areas. Verification-owned roots now use the durable PID manifest; isolated
creators retain their existing local `try`/`finally` cleanup. The explicit
inventory is captured here rather than added as volatile live documentation.

Inventory: `scripts/package-native-release.ts` (`px-package-`, `px-verify-`,
local `finally`); `src/adapters/agents/opencode-export.ts`
(`opencode-export-`, local `finally`); `src/adapters/cli/commands/integrate.ts`
(`parallix-integrate-noise-`, local `finally`); verification adapters
(`node-coverage-`, `coverage-gate-tmp-`, `graphify-`, `mutation-gate-`,
`redgreen-`, tracked or local `finally`); `src/composition/create-cli.ts`
(`mktemp`, shell trap); and test fixtures, which use bootstrap registration or
their own fixture `finally` cleanup. `test/e2e-real-agent-smoke.test.ts` now
records its repository and capture roots before use.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Recorded roots for all observed classes are reclaimable without prefix sweeping. | `test/task-2365-tmp-reclamation.test.ts` — "recorded dead roots are reclaimed while live and unrecorded roots survive" | Pass |
| Every temporary-root creator has an ownership or local-finally contract. | `rg -n --glob '*.{ts,js,mjs,cjs,sh}' 'mkdtempSync\\(|mktemp\\b|/tmp/' src scripts test`; `test/helpers/temp-dir.ts` | Pass |
| Test runner, coverage gate, and wrappers clean before forwarding completion or handled signals. | `test/run-default-tests.ts`; `src/adapters/verification/coverage-gate.ts` | Pending CP-3 checks |
| Later eligible runs recover only dead recorded owners. | `src/adapters/verification/temp-root-registry.ts`; `test/task-2365-tmp-reclamation.test.ts` | Pass |
| Real-agent roots retain opt-in diagnostics and clean otherwise. | `test/e2e-real-agent-smoke.test.ts` | Pass |
| Representative verification leaves no new non-retained roots. | `npm test -- test/task-2365-tmp-reclamation.test.ts test/coverage-gate.test.ts` | Pass (focused) |
| Static analysis passes on the final tree. | `./scripts/verify-local.sh static-analysis` | Pending CP-4 |

Next action: exercise runner and coverage-gate cleanup ordering for failure and handled-signal paths, then commit CP-3.
