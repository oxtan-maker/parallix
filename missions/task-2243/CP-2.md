# CP-2 — Variant B ordering inventory

Inventoried the committed Variant B path. The initial probe runs `git merge --no-commit` followed immediately by `git merge --abort`; an abort failure throws `IntegrationAbort` before the squash path. The squash merge follows only after a cleanly aborted probe, and the review-to-approved promotion plus task completion occur in final closeout before the landed commit. The required ordering was already present in the mission parent, so no duplicate implementation change was made. The CP-1 abort fixture remains unexecuted because the canonical test build is blocked by the unrelated `package-lock.json` state described in CP-1.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Forced probe-abort failure leaves the review task fixture unchanged | `test/task-2243-probe-abort-promotion.test.js:19`, `src/platform/runtime/lib/commands/integrate.ts:793` | PENDING focused test execution |
| Promotion runs only after the Variant B probe has been aborted and squash succeeds | `src/platform/runtime/lib/commands/integrate.ts:782`, `src/platform/runtime/lib/commands/integrate.ts:918`, `src/platform/runtime/lib/commands/integrate.ts:940` | PASS |
| Successful Variant B closeout retains promotion and completion | `src/platform/runtime/lib/commands/integrate.ts:940`, `src/platform/runtime/lib/commands/integrate.ts:942` | PASS — implementation inventory; focused test confirmation pending |
| Abort failure surfaces and stops without a status rewrite | `src/platform/runtime/lib/commands/integrate.ts:793`, `src/platform/runtime/lib/commands/integrate.ts:900` | PASS — both initial and conflict-path abort failures throw `IntegrationAbort` before closeout |
| Final verification gate passes | `./scripts/verify-local.sh all` | PENDING CP-3; blocked by unresolved `react-devtools-core` during build |

Next action: strengthen the landed-closeout assertion to prove promotion and completion occur before the landed commit, then run the focused tests and required gate when the unrelated dependency state is restored.
