# CP 2 — Reach closeout after a landed merge

Narrowed the Forgejo merged-PR preflight failure: it is informational only when the authoritative Mission lifecycle is already `integration` or `done`. All other states, including `review`, retain the `pr-merged` failure and recovery guidance.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 permits a merged PR only for lifecycle integration/done | `test/task-2508-interrupted-landed-integration-repro.test.ts`, `"printIntegrationPreflight does not fail on a merged PR for a landed integration"` | PASS |
| Approval authority remains closed for non-landed lifecycle states | `test/task-2508-interrupted-landed-integration-repro.test.ts`, `src/adapters/cli/commands/integrate.ts::printIntegrationPreflight` | PASS |
| The declared reproduction is green | `node --import tsx test/task-2508-interrupted-landed-integration-repro.test.ts` | PASS |

Next action: Add focused closeout and cleanup assertions that prove the resumed local integration completes and cleans up exactly once.
