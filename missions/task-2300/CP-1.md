# CP-1 — Integration gate execution map

Mapped the active integration flow. `src/platform/runtime/lib/commands/integrate.ts` is the authoritative runtime: the packaged CLI imports it through `src/platform/runtime/index.ts`. Gate selection comes from `config/integration-pipelines.json`; the wrapper is `scripts/verify-local.sh integrate`. The current wrapper already propagates its selected root to `npm run test:integration` through `PARALLIX_EXECUTION_ROOT`, but `integrate` currently allows a gate bypass and invokes the gate wrapper before the squash/closeout tree is finalized. The implementation must move mandatory gate execution to a finalized candidate tree before any merge, closeout, cleanup, or post-integrate action, with durable identity diagnostics.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A failing integration fixture stops all integration side effects | `src/platform/runtime/lib/commands/integrate.ts:704`; `test/integrate.test.ts` | PENDING — CP-2 will add an ordering fixture |
| Failure identifies gate and selected mission slug, with root and tree identity | `src/platform/runtime/lib/commands/integrate.ts:726`; `src/platform/runtime/lib/commands/integrate.ts:892` | PENDING — diagnostics lack the required complete identity record |
| Wrong-root execution fails closed across subprocess boundaries | `test/run-default-tests.js:11`; `scripts/verify-local.sh:33` | PARTIAL — wrapper and test runner validate root, command orchestration still needs enforcement |
| Unconditional integration suite runs for every diff class | `config/integration-pipelines.json:16`; `test/verify-local-integrate.test.ts` | PASS — preserve during implementation |
| Gate runs after finalization and before first side effect | `src/platform/runtime/lib/commands/integrate.ts:694`; `src/platform/runtime/lib/commands/integrate.ts:744` | FAIL — current ordering is before squash/final closeout |
| All retained entrypoints agree on canonical behavior | `src/platform/runtime/index.ts:18`; `src/platform/runtime/lib/commands/integrate.ts:626` | PARTIAL — CP-2 will cover package/runtime agreement |
| Normal bypass is rejected or auditable and merge-blocking | `src/platform/runtime/lib/commands/integrate.ts:504`; `src/platform/runtime/lib/commands/integrate.ts:704` | FAIL — normal bypass is currently accepted |
| Named rebase tests normalize `-C <root>` Git arguments | `test/rebase.test.ts:608`; `test/rebase_diagnostics.test.ts:58` | PENDING — mocks still inspect positional arguments |
| Changed tests remain hermetic | `test/integrate.test.ts`; `test/rebase.test.ts` | PENDING — CP-2 fixtures will mock all process and Git boundaries |
| Required verification and final evidence are captured | `./scripts/verify-local.sh integrate`; `missions/task-2300/MISSION.md:82` | PENDING — CP-4 only |

Next action: add focused hermetic tests for finalized-tree gate ordering, fail-closed diagnostics, bypass rejection, entrypoint agreement, and normalized rebase Git mocks.
