# CP 1 — Red merged-PR closeout reproduction

Added the declared regression test for a lifecycle `integration` mission whose Forgejo PR is already `merged`. The test currently fails because preflight reports `pr-merged`, proving the closeout path is blocked before the existing idempotent persistence helper can run.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 reproduces the merged-PR preflight blocker for a landed integration | `test/task-2508-interrupted-landed-integration-repro.test.ts`, `"printIntegrationPreflight does not fail on a merged PR for a landed integration"` | RED |
| The failure is isolated to the intended gate | `node --import tsx test/task-2508-interrupted-landed-integration-repro.test.ts`, `src/adapters/cli/commands/integrate.ts::printIntegrationPreflight` | RED |

Next action: Narrow only the merged-PR preflight branch for lifecycle `integration` and `done`, then turn this reproduction green.
