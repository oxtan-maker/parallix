# CP-3 — Gate wiring: CodeQL in the integration path

## Work done
Wired the CodeQL gate as an unconditional, blocking gate in both integration
configurations, ordered after the cheap static/build checks and before the
expensive E2E / real-agent gates.

- `config/integration-pipelines.json`: `codeql` gate, `order: 4`, `always: true`,
  command `npm run test:codeql`. It runs after `build` (order 2) and
  `integration-suite` (order 3) and before `workflow` (order 50) and
  `custom-agent-smoke` (order 51). This is the merge-gate authority per
  `AGENTS.md` (`adapters.gates.preIntegration` mirror) and documented in
  `ADR 0041` (integration-pipeline-gates).
- `workflow.config.json` `adapters.gates.preIntegration`: `codeql` entry,
  `order: 4`, command `npm run test:codeql`, after `verification` (order 2) and
  `integration-suite` (order 3), before `workflow` (order 5).
- Query suite recorded (see CP-1/CP-2): `security/code-scanning`, never weakened.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Unconditional CodeQL gate in integration-pipelines.json | `config/integration-pipelines.json` → `codeql` gate `"always": true`, `order: 4` | PASS |
| CodeQL gate ordered after build/static, before E2E gates | `config/integration-pipelines.json` orders: build 2, integration-suite 3, codeql 4, workflow 50, custom-agent-smoke 51 | PASS |
| CodeQL gate mirrored into workflow.config.json preIntegration | `workflow.config.json` `adapters.gates.preIntegration` has `codeql` order 4 after verification(2)/integration-suite(3), before workflow(5) | PASS |
| Query suite recorded and not weakened | `scripts/codeql-sast.sh` records `security/code-scanning` (see CP-1) | PASS |
| Gate runs during integration | `./scripts/verify-local.sh integrate` executes the `codeql` gate command | PASS |

## Next action
Commit the gate wiring, then proceed to CP-4 (remediation / suppression
baseline).
