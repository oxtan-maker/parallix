# CP-3 — Final verification

The declared mission verification gate passed on the completed rebounce flow.
The final regression test exercises an existing pull request, a deterministic
declared static-analysis failure, implementer repair context, one retry,
pre-review replay, and progression into the reviewer round. The handler keeps
explicit infrastructure and state-machine diagnostics on the existing
human-intervention path and retains retry exhaustion.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression is red on the mission parent and green with the repair | `test/task-2353-rebounce-reproduction.test.ts`, `"task-2353 repro: declared pre-review gate rebounces, replays, and resumes the review loop"` | PASS |
| Declared gate failure sends command, diagnostics, classification, retry, and repair instructions to the implementer | `src/adapters/review/review-loop.ts:450`, `test/task-2353-rebounce-reproduction.test.ts:69` | PASS |
| Successful repair reruns rebase and the declared gate before review continues | `src/adapters/review/review-loop.ts:1303`, `test/task-2353-rebounce-reproduction.test.ts:74` | PASS |
| Retry increments once, remains bounded, and exhaustion preserves human intervention | `src/adapters/review/review-loop.ts:411`, `test/task-1385-pre-review-gate.test.ts` | PASS |
| Declared gate failure is not labelled as a Git-hook failure | `src/adapters/review/review-loop.ts:450`, `test/task-2353-rebounce-reproduction.test.ts:79` | PASS |
| Regression test is fully mocked and avoids real Forgejo, agents, and process execution | `test/task-2353-rebounce-reproduction.test.ts:16` | PASS |
| Mission-declared verification gate passes | `./scripts/verify-local.sh all` | PASS |

Next action: Hand the committed mission branch to Parallix’s review lifecycle without changing backlog metadata.
