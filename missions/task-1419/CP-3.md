# CP-3: Add repository-local build gate to config/integration-pipelines.json

## Summary

Added the `build` gate entry to `config/integration-pipelines.json` with the metadata required by SC1: command `npm run build:cjs`, order 2, run_last false, enabled true, and areas limited to `lib` and `workflow`. Existing gate orders are preserved: lib (1), mutation (40), workflow (50, run_last), custom-agent-smoke (51, run_last).

Added 4 configuration assertion tests that verify the repo config directly:
- Build gate metadata correctness
- Existing gate order preservation
- Plan selection with the actual repo config for lib changes
- Plan exclusion for docs-only changes with the actual repo config

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Build gate command is `npm run build:cjs` | config/integration-pipelines.json:8; test "repo config declares build gate with correct metadata (task-1419)" | PASS |
| Build gate order is 2 | config/integration-pipelines.json:9 | PASS |
| Build gate run_last is false | config/integration-pipelines.json:10 | PASS |
| Build gate enabled is true | config/integration-pipelines.json:11 | PASS |
| Build gate areas are [lib, workflow] | config/integration-pipelines.json:12 | PASS |
| lib gate remains order 1 | config/integration-pipelines.json:5; test "repo config preserves existing gate orders (task-1419)" | PASS |
| mutation gate remains order 40 | config/integration-pipelines.json:15 | PASS |
| workflow gate remains order 50, run_last true | config/integration-pipelines.json:19-20 | PASS |
| custom-agent-smoke remains order 51, run_last true | config/integration-pipelines.json:23-24 | PASS |
| Plan selects lib and build for lib changes | test "getIntegrationGatePlan with repo config selects lib and build for lib changes (task-1419)" | PASS |
| Plan excludes build for docs-only changes | test "getIntegrationGatePlan with repo config excludes build for docs-only changes (task-1419)" | PASS |

Next action: Exercise the lifecycle boundary — run `./scripts/verify-local.sh integrate` in dry-run mode with controlled changed areas, then run the static-analysis and build gates (CP-4).
