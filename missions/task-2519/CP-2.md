# CP-2: Remove the automatic CodeQL gate entries

## Summary
- Deleted the `codeql` gate (`npm run test:codeql`, order 4) from `workflow.config.json` `adapters.gates.preIntegration`. The remaining entries keep their original keys, commands, and order values: `build` (1), `verification` (2), `integration-suite` (3), `workflow` (5), `agent-smoke` (6).
- Deleted the `codeql` gate block from `config/integration-pipelines.json`. `build` (order 2, areas lib/workflow), `integration-suite` (order 3, always), `workflow` (order 50, run_last), and `custom-agent-smoke` (order 51, run_last) are unchanged.
- Extended `test/integration-pipelines.test.ts` test `"repo config preserves remaining gate orders (task-1419)"` with an assertion that `config.gates.codeql` is `undefined`.
- `package.json` still defines `"test:codeql": "bash scripts/codeql-sast.sh"`; `scripts/codeql-sast.sh` and its suppressions are untouched.
- README: the manual scan is now described as run manually and not part of local integration (previously "unconditional in the integration path").

Focused runs on the edited tree:
- `node --import tsx --test test/repository-gates.test.ts` — 23 pass, 0 fail (the CP-1 red test is now green).
- `node --import tsx --experimental-test-module-mocks --test test/integration-pipelines.test.ts` — 48 pass, 0 fail, 10 skipped.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `preIntegration` has no codeql gate and retains exactly the five gates | `test/repository-gates.test.ts`, test `"this repository selects build, verification, integration-suite, workflow, and agent-smoke gates without codeql"` (deepEqual on plan keys + no `npm run test:codeql` command) | PASS |
| `config/integration-pipelines.json` has no codeql gate and retains build, integration-suite, workflow, custom-agent-smoke with their commands and orders | `test/integration-pipelines.test.ts`, tests `"repo config declares build gate with correct metadata (task-1419)"`, `"repo config preserves remaining gate orders (task-1419)"`, `"repo integration config keeps workflow gate on the targeted mission-lifecycle suite"` | PASS |
| `package.json` still defines `test:codeql` as `bash scripts/codeql-sast.sh` | `package.json` (`npm run test:codeql` remains runnable; `scripts/codeql-sast.sh` unchanged) | PASS |
| Docs reflect the workflow change | `README.md` test-command list now marks CodeQL as manual | PASS |
| Declared gates pass on the final tree | Deferred to CP-3 | PENDING |

Next action: run the four mission gates (`npm test -- --unit-test-headroom`, `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh integrate`, `./scripts/verify-local.sh all`) and record whether the integrate path invoked `npm run test:codeql`.
