# CP-4 — Final verification record

Verified the clean committed mission tree at `/home/magnus/code/parallix-task-2300`, commit `09aad9dbf43860a3b8883f37c8652779a63a854c`, tree `dba7296dc16d3eed844ded9f3c0a4244a7e9cac9`. The resolved integration plan executed `build` followed by the unconditional `integration-suite`; both passed. The all-suite, static-analysis, and integration commands all exited 0. The fail-closed tests prove that a dirty/wrong selected tree or mandatory-plan failure happens before the merge/stash/closeout portion of `integrate` begins.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A failing integration fixture stops all integration side effects | `test/integrate.test.ts:181`; `src/platform/runtime/lib/commands/integrate.ts:705` | PASS |
| Failure identifies gate and selected mission slug, with root and tree identity | `src/platform/runtime/lib/commands/integrate.ts:720`; `src/platform/runtime/lib/commands/integrate.ts:728` | PASS |
| Wrong-root execution fails closed across subprocess boundaries | `src/platform/runtime/lib/commands/integrate.ts:455`; `test/run-default-tests.js:11` | PASS |
| Unconditional integration suite runs for every diff class | `config/integration-pipelines.json:16`; `test/verify-local-integrate.test.ts:105` | PASS |
| Gate runs after finalization and before first side effect | `src/platform/runtime/lib/commands/integrate.ts:705`; `src/platform/runtime/lib/commands/integrate.ts:746` | PASS |
| All retained entrypoints agree on canonical behavior | `src/platform/runtime/index.ts:18`; `src/platform/runtime/lib/commands/integrate.ts:1920` | PASS |
| Normal bypass is rejected or auditable and merge-blocking | `src/platform/runtime/lib/commands/integrate.ts:540`; `test/integrate.test.ts:202` | PASS |
| Named rebase tests normalize `-C <root>` Git arguments | `"rebase caps failed continue retries when rebase remains active"`; `"rebase reports git output on failed continue attempt"` | PASS |
| Changed tests remain hermetic | `test/bootstrap-parallix-home.js:25`; `test/integrate.test.ts:181` | PASS |
| Final gates passed on selected root `/home/magnus/code/parallix-task-2300`, commit `09aad9dbf43860a3b8883f37c8652779a63a854c`, tree `dba7296dc16d3eed844ded9f3c0a4244a7e9cac9`; resolved plan `build`, `integration-suite`; failed-gate proof has no merge/closeout side effects | `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh integrate`; `test/integrate.test.ts:181` | PASS |

Next action: hand off the committed mission artifacts; do not run lifecycle transitions from this worktree.
