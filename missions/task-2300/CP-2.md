# CP-2 — Hermetic gate and rebase coverage

Added hermetic coverage for final-tree identity and normal bypass rejection, changed the verifier fixtures to require a resolved mandatory plan, and normalized the two named rebase Git mocks for `-C <executionRoot>` arguments. Focused tests pass with the project test-runtime bootstrap.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A failing integration fixture stops all integration side effects | `test/integrate.test.ts:181` | PARTIAL — final-tree rejection is covered; CP-3 retains orchestration ordering |
| Failure identifies gate and selected mission slug, with root and tree identity | `src/platform/runtime/lib/commands/integrate.ts:720`; `src/platform/runtime/lib/commands/integrate.ts:728` | PASS |
| Wrong-root execution fails closed across subprocess boundaries | `test/integrate.test.ts:181`; `test/run-default-tests.js:11` | PASS |
| Unconditional integration suite runs for every diff class | `test/verify-local-integrate.test.ts:105`; `config/integration-pipelines.json:16` | PASS |
| Gate runs after finalization and before first side effect | `src/platform/runtime/lib/commands/integrate.ts:705`; `src/platform/runtime/lib/commands/integrate.ts:746` | PASS — clean final tree is captured before stash/merge side effects |
| All retained entrypoints agree on canonical behavior | `src/platform/runtime/index.ts:18`; `test/integrate.test.ts:154` | PASS |
| Normal bypass is rejected or auditable and merge-blocking | `test/integrate.test.ts:202`; `src/platform/runtime/lib/commands/integrate.ts:540` | PASS |
| Named rebase tests normalize `-C <root>` Git arguments | `test/rebase.test.ts:608`; `test/rebase_diagnostics.test.ts:59` | PASS |
| Changed tests remain hermetic | `test/bootstrap-parallix-home.js:25`; `test/integrate.test.ts:181` | PASS |
| Required verification and final evidence are captured | `./scripts/verify-local.sh integrate`; `missions/task-2300/MISSION.md:82` | PENDING — CP-4 will run and record final gates |

Next action: commit the fail-closed orchestration and checkpoint guidance, update Graphify, then run focused tests from the generated test runtime.
