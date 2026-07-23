# CP-3 — Fail-closed orchestration implemented

Implemented mandatory integration-gate enforcement in the canonical runtime. The selected mission worktree is required to be a clean Parallix checkout, its commit and tree are captured before gate execution, and its root is propagated through `PARALLIX_EXECUTION_ROOT`. Failure diagnostics identify the slug, root, commit, and tree before any merge-side action. The shell gate wrapper now rejects absent, empty, or inapplicable gate plans. Handoff repair guidance now explicitly requires the integration verifier for integrations.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A failing integration fixture stops all integration side effects | `src/platform/runtime/lib/commands/integrate.ts:705`; `test/integrate.test.ts:181` | PASS |
| Failure identifies gate and selected mission slug, with root and tree identity | `src/platform/runtime/lib/commands/integrate.ts:720`; `src/platform/runtime/lib/commands/integrate.ts:728` | PASS |
| Wrong-root execution fails closed across subprocess boundaries | `src/platform/runtime/lib/commands/integrate.ts:455`; `test/run-default-tests.js:11` | PASS |
| Unconditional integration suite runs for every diff class | `config/integration-pipelines.json:16`; `test/verify-local-integrate.test.ts:105` | PASS |
| Gate runs after finalization and before first side effect | `src/platform/runtime/lib/commands/integrate.ts:705`; `src/platform/runtime/lib/commands/integrate.ts:746` | PASS |
| All retained entrypoints agree on canonical behavior | `src/platform/runtime/index.ts:18`; `src/platform/runtime/lib/commands/integrate.ts:1920` | PASS |
| Normal bypass is rejected or auditable and merge-blocking | `src/platform/runtime/lib/commands/integrate.ts:540`; `test/integrate.test.ts:202` | PASS |
| Named rebase tests normalize `-C <root>` Git arguments | `test/rebase.test.ts:632`; `test/rebase_diagnostics.test.ts:79` | PASS |
| Changed tests remain hermetic | `test/bootstrap-parallix-home.js:25`; `test/integrate.test.ts:181` | PASS |
| Required verification and final evidence are captured | `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh integrate` | PENDING — CP-4 executes final gates |

Next action: commit this implementation checkpoint and run all three mission-declared verification commands on the clean committed tree.
