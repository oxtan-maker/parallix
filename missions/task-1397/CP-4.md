# CP-4: Land the deterministic lifecycle E2E suite

## Summary

The lifecycle suite now drives a temp repository through the real `draft`, worktree entry, `active`, `review`, and `integrate` commands, with only the agent replaced by a deterministic `custom` stub. The harness also carries graphify into the PATH when available and asserts the mission/worktree/backlog/review artifacts that previously regressed in the 1317/1352/1327/1275 cluster.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The harness stubs only the agent and uses `custom` semantics rather than depending on Codex availability | `test/e2e-mission-lifecycle.test.js:237-257`, `test/e2e-mission-lifecycle.test.js:444`, `test/e2e-mission-lifecycle.test.js:466` | PASS |
| The temp repo preserves graphify in PATH when available so graphify remains part of the real workflow environment | `test/e2e-mission-lifecycle.test.js:242-245` | PASS |
| The scenario executes the real lifecycle from base checkout to mission worktree and back through integrate | `test/e2e-mission-lifecycle.test.js:421-487` | PASS |
| Feature-branch missions assert the recorded base branch and verify integrate lands on the feature branch instead of `main` | `test/e2e-mission-lifecycle.test.js:454-458`, `test/e2e-mission-lifecycle.test.js:495-500`, `test/e2e-mission-lifecycle.test.js:563-575` | PASS |
| Primary-branch missions assert clean integration to `main` and task completion | `test/e2e-mission-lifecycle.test.js:577-586` | PASS |
| Artifact assertions cover mission IDs, checkpoints, milestones, and review events to guard the composition boundary | `test/e2e-mission-lifecycle.test.js:468-480`, `test/e2e-mission-lifecycle.test.js:588-596` | PASS |
| Integration gate tests cover workflow-owned surfaces and `lib`-touching missions resolving the workflow gate | `test/integration-pipelines.test.js:458-469`, `test/integration-pipelines.test.js:501-556` | PASS |

Next action: Run final verification, prove the configured integration gate path executes the lifecycle suite, and prepare handoff evidence.
