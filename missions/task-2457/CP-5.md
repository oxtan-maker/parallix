# CP-5: Retire mutation testing

The unusable mutation-testing implementation was removed: its executable,
CLI command, dependency, configuration, tests, pipeline entry, and live ADR.
Any future quality strategy requires a separate mission.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Generic repository gates remain configured and fail closed | `workflow.config.json` retains build, verification, integration-suite, workflow, and agent-smoke gates | PASS |
| Mutation testing is not configured during integration | `workflow.config.json` and `config/integration-pipelines.json` have no mutation gate | PASS |
| Legacy mutation tooling is removed | No active executable, dependency, configuration, test, or live ADR remains | PASS |
| Generic configuration remains valid | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: evaluate any replacement quality approach in a separate mission.
