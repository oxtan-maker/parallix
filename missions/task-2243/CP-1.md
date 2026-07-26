# CP-1 — Probe-abort regression fixture

Added `test/task-2243-probe-abort-promotion.test.js`, a fully mocked Variant B fixture that starts a `git merge --no-commit`, forces `git merge --abort` to fail, checks the nonzero integration result, and compares the review-approved task file with its original bytes. No Forgejo request or real Git checkout is used. The fixture is not yet green in this checkout: its normal command is blocked before tests execute because the pre-existing, unrelated `package-lock.json` edit leaves Ink's `react-devtools-core` import unresolved during the required build.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Forced probe-abort failure leaves the review task fixture unchanged | `test/task-2243-probe-abort-promotion.test.js:19`, `"Variant B rejects a failed probe abort without promoting the review-approved task fixture (task-2243)"` | BLOCKED — test build is blocked by the pre-existing lockfile change |
| Promotion occurs after the probe safety boundary | `src/platform/runtime/lib/commands/integrate.ts:782`, `src/platform/runtime/lib/commands/integrate.ts:936` | PASS — existing implementation inventory shows the ordering |
| Successful Variant B closeout retains promotion and completion | `test/task-1109.test.ts`, `"integrate Variant B promotes a review-approved task only after the squash merge"` | PENDING focused success-path confirmation |
| Abort failure surfaces and stops without a status rewrite | `test/task-2243-probe-abort-promotion.test.js:81`, `src/platform/runtime/lib/commands/integrate.ts:793` | PENDING focused test execution |
| Final verification gate passes | `./scripts/verify-local.sh all` | PENDING CP-3; currently blocked by the build dependency resolution failure |

Next action: confirm the committed Variant B sequence against the new fixture, then run the focused abort and landed-closeout assertions once the unrelated lockfile state permits the canonical build.
