# CP 1: Failing reproduction test

## Summary
Added `test/task-1431-integration-preflight-repro.test.js` with a scenario that
constructs a `printIntegrationPreflight` context whose backlog task is
resolved from a temp "base worktree" fixture (`context.baseWorktree`), while
`process.cwd()` (the actual test process root) does not contain that task
file at all. At the mission parent commit, `printIntegrationPreflight`
resolves classification via `stats.resolveMissionClassification(context.slug)`
with no root argument, defaulting to `process.cwd()` — the wrong root — which
reproduces the transcripted defect exactly:

```
[PASS] Backlog task: task-preflight-test - repro.md (ready-for-integration)
[FAIL] Backlog classification: Could not resolve backlog task for task-preflight-test.
```

Verified red-before-fix by stashing the (not-yet-applied) source fix and
re-running the suite: the classification test failed with the transcripted
message, and the null-slug tests failed too (`buildIntegrationContext`
threw an unrelated `TypeError` on `slug.toLowerCase()` and
`printIntegrationPreflight` did not throw at all), confirming the test locks
real, currently-unfixed defects rather than already-passing behavior.

## Goal Check

| Criterion | Evidence |
|---|---|
| Reproduction test file exists at the exact path named in the mission | `test/task-1431-integration-preflight-repro.test.js` |
| Test fails at the parent commit with the transcripted false-classification message | Verified via `git stash` of the source fix + rerun; failure output matched `Could not resolve backlog task for task-preflight-test.` |
| Test is structured to go green once the lookup root is corrected | `test/task-1431-integration-preflight-repro.test.js:69` (`printIntegrationPreflight resolves classification from the mission base worktree, not process.cwd()`) |

Next action: Implement the CP 2 source fix in `lib/commands/integrate.ts` so backlog task/classification resolution uses the mission's base-worktree root, and re-run the full repro suite to confirm it goes green.
