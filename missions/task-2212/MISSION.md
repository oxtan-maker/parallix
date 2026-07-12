# Mission: Isolate failed-test cleanup from the development worktree (task-2212)

## Goal

Make the test scenarios that create `feature/e2e-base` and the TASK-2198 stale-active backlog fixture self-cleaning: an assertion failure or an interrupted test path must not leave that branch, a worktree, or a task fixture in the developer's checkout.

## Why Now

The backlog reports that `feature/e2e-base` and a stale TASK-2198 backlog artifact survive failed tests. Those leftovers alter the state consumed by later workflow tests and by developers, so a failed run can contaminate unrelated work and obscure the original failure.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium — the reported artifacts identify the affected test behaviors, but the precise cleanup path must be confirmed during execution.
- Main driver: prevent test failures from mutating the shared development checkout after the test exits.

## Scope

- Add a regression test at `test/task-2212-repro.test.js` that exercises the reported failed-test cleanup scenario.
- Inspect and correct the test setup/teardown responsible for the `feature/e2e-base` branch, its associated test worktree if created, and the TASK-2198 stale-active task fixture.
- Keep test-created git and backlog state confined to the test fixture or remove it reliably after both passing and failing paths.
- Document proof for the red-to-green regression and the repository verification gate in checkpoint records.

## Out of Scope

- Changes to production branch, worktree, backlog, mission-lifecycle, or integration behavior outside what is necessary for test cleanup.
- Broad test-runner or test-framework migration.
- Cleanup of developer-created branches, worktrees, or backlog tasks that do not originate from the affected tests.
- Changing the task's workflow state, assignee, or integration-gate configuration.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various").

- SC1: `test/task-2212-repro.test.js` contains a named regression test that fails on the mission parent commit because the reported failed-test path leaves `feature/e2e-base`, a related test worktree, or the TASK-2198 stale-active fixture behind, and passes after the cleanup change.
- SC2: After the affected e2e test's forced failure path completes, no branch named `feature/e2e-base` and no worktree created for that scenario remains outside its fixture lifecycle.
- SC3: After the affected review test's forced failure path completes, no TASK-2198 stale-active fixture file remains under `backlog/tasks/`.
- SC4: The tests that create those artifacts run cleanup on both normal completion and assertion/error failure without masking the original test error.
- SC5: No focused test (`.only`) or unannotated skipped test is introduced by the mission.
- SC6: `./scripts/verify-local.sh all` passes on the completed tree.

## Risks and Assumptions

- Risk: removing a branch or worktree by a broad name/path could delete a developer's real work; cleanup must operate only on artifacts created by the test fixture.
- Risk: teardown errors can replace the assertion error that made the test fail; preserve the original failure while reporting cleanup faults appropriately.
- Assumption: the reported `feature/e2e-base` and TASK-2198 stale-active artifacts are created by repository tests, not by a concurrently running developer process.
- Assumption: the repository's existing `node --test` conventions can run the reproduction test without changing the test framework.

## Checkpoints

- CP1 — Lock the bug before any cleanup fix: author `test/task-2212-repro.test.js`. It must force the reported failing e2e/review-test path, then assert that `feature/e2e-base`, any worktree created for that scenario, and the TASK-2198 stale-active fixture are absent after the failed path finishes. At the mission parent commit, at least the assertion exposing the leftover artifact must fail (red); after the cleanup change it must pass (green). Do not write the cleanup fix before recording the red result.
- CP2 — Identify ownership: trace the test setup and teardown that create the branch/worktree and backlog fixture; record the exact test names and source locations that own each artifact.
- CP3 — Make cleanup failure-safe: change only the necessary test fixture setup/teardown so the artifacts from CP2 are removed after success, assertion failure, and thrown error, while retaining the original test failure.
- CP4 — Demonstrate green isolation: run the regression test after the change and capture evidence that its named scenario passes without leaving its tracked artifacts.
- CP5 — Complete repository verification: run `./scripts/verify-local.sh all` on the final tree and record its result against SC6.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include a concise work summary, a `## Goal Check` heading exactly as written, and this exact 3-column table header:

| Criterion | Evidence | Status |

Include one row for every applicable success criterion. Evidence must use forms Parallix already verifies today: existing file:line references, exact test names, ADR references, test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. For this mission, pair red/green results with `test/task-2212-repro.test.js`, its exact test name, and the command that ran it; pair the final gate with `./scripts/verify-local.sh all`. Raw `stat`/`ls` output or generic prose alone is not enough; when shell output is useful, pair it with at least one accepted reference above. End every checkpoint with a concrete `Next action:` line.

Reproduction-Test: test/task-2212-repro.test.js

## Gates

- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- Do not modify application behavior in `lib/`, including production branch/worktree or backlog-management code, unless a new authorized mission is created for that work.
- Do not alter `config/integration-pipelines.json`, workflow state transitions, or verification scripts.
- Do not remove or rename backlog tasks other than test-created fixture artifacts proven to be owned by this mission's tests.
- Do not modify files outside test fixtures, their directly required test helpers, mission checkpoint records, and documentation that is demonstrably required by the behavior change.

## Stop Rules

- Stop and request a follow-up mission if reproducing the artifact requires changing production behavior in `lib/` or integration configuration.
- Stop and report the evidence if the parent commit cannot produce the asserted leftover artifact; do not weaken the regression assertion to manufacture a red state.
- Stop and request scope review if cleanup ownership spans unrelated test suites or requires a test-infrastructure rewrite.
- Stop immediately if proposed cleanup cannot uniquely identify test-owned branch, worktree, or task-fixture paths without risking developer-created state.
