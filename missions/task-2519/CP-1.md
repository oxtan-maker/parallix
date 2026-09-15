# CP-1: Focused coverage for the CodeQL-free integration plan

## Summary
Inspected the two integration configuration consumers:
- `workflow.config.json` `adapters.gates.preIntegration` (read by `loadPhaseGates`, the `px integrate` authority) lists `codeql` (`npm run test:codeql`) at order 4.
- `config/integration-pipelines.json` (read by `./scripts/verify-local.sh integrate`) declares a `codeql` gate with `always: true`.

Tightened the existing repository-plan test in `test/repository-gates.test.ts`. It now pins the exact `preIntegration` key sequence and rejects any gate whose command is `npm run test:codeql`.

Test renamed to: `"this repository selects build, verification, integration-suite, workflow, and agent-smoke gates without codeql"`.

Before the configuration edit (red), running
`node --import tsx --test --test-name-pattern='without codeql' test/repository-gates.test.ts`
fails with:
`actual: [ 'build', 'verification', 'integration-suite', 'codeql', 'workflow', 'agent-smoke' ]`.
The green result is recorded in CP-2 after the entries are removed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Focused coverage asserts the repository plan excludes codeql and retains the five gates | `test/repository-gates.test.ts`, test `"this repository selects build, verification, integration-suite, workflow, and agent-smoke gates without codeql"` | PASS (red before config edit, as intended) |
| Both integration config consumers identified | `workflow.config.json`, `config/integration-pipelines.json` | PASS |
| `workflow.config.json` excludes codeql | Pending CP-2 | PENDING |
| `config/integration-pipelines.json` excludes codeql | Pending CP-2 | PENDING |

Next action: delete the `codeql` entries from `workflow.config.json` and `config/integration-pipelines.json`, then rerun the focused `without codeql` test to turn it green.
