# CP-1: Failing temporary-capture reproduction

## Summary

Added the focused reproduction for the real-agent smoke capture writer. The test injects an `ENOSPC` failure while opening stderr after the writer has created stdout; it currently fails because the owned stdout capture remains. The smoke test exposes only this helper under a dedicated test-only environment flag so the reproduction exercises the actual writer without registering the workstation-dependent smoke test.

Parent-commit red command: `node --test test/task-2241-tmp-cleanup-repro.test.js` (run with the reproduction overlaid onto the mission parent) exited 1 because `runWorkflowAllowFail` was unavailable before this checkpoint. The same exact command on the pre-fix checkpoint tree exited 1 with `owned stdout capture must be removed after stderr setup failure` (`actual: true`).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 inventory identifies in-scope writers | `test/e2e-real-agent-smoke.test.js:464` | PENDING CP-2 |
| SC2 covers success and applicable failure cleanup | `test/task-2241-tmp-cleanup-repro.test.js`, `"real-agent smoke capture removes its first stdout file when stderr capture setup fails"` | RED (expected) |
| SC3 cleans smoke stdout/stderr captures on terminal paths | `test/e2e-real-agent-smoke.test.js:464` | RED (expected) |
| SC4 restricts cleanup to current-run-owned paths | `test/task-2241-tmp-cleanup-repro.test.js` | PENDING CP-2 |
| SC5 asserts bounded repeated-run residue | `test/e2e-real-agent-smoke.test.js` | PENDING CP-3 |
| SC6 preflights temporary capacity | `test/e2e-real-agent-smoke.test.js` | PENDING CP-3 |
| SC7 preserves and classifies Git storage failures | `lib/commands/handoff.ts:610` | PENDING CP-3 |
| SC8 verification gate passes | `./scripts/verify-local.sh all` | PENDING CP-3 |

Next action: introduce a shared owned-temporary-artifact helper, move smoke capture ownership into it, and add terminal-path/retention/non-owned-path coverage.
