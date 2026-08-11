# CP-1 — Reproduction test

Added the focused mocked reproduction for an existing pull request whose
declared static-analysis gate fails once and whose implementer repair succeeds.
On the parent behavior it fails because the repair prompt is classified as
`GateFailure — AutoSendBack` instead of the required `GitBlockers — AutoRepair`;
the assertion also covers the intended rebase, gate replay, and next-round
continuation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction covers an existing PR and declared static-analysis gate exit 1 | `test/task-2353-rebounce-reproduction.test.ts:5` | PASS |
| Reproduction captures repair context and retry accounting | `test/task-2353-rebounce-reproduction.test.ts:69` | PASS |
| Parent behavior is demonstrably red before the workflow fix | `npx tsx --test test/task-2353-rebounce-reproduction.test.ts`, `"task-2353 repro: declared pre-review gate rebounces, replays, and resumes the review loop"` | PASS (expected red) |
| Reproduction remains inside mocked unit-test boundaries | `test/task-2353-rebounce-reproduction.test.ts:16` | PASS |

Next action: Change the declared-gate classification and resume the review loop after a successful implementer repair.
