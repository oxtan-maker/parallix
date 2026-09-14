# Mission: Stop integration failure handling from mutating main or inventing backlog IDs (task-2507)

## Goal

Make failed integration handling leave the primary checkout unchanged and stop it from fabricating `TASK-MAINGATE-*` backlog entries, while retaining the existing bounded mission-regression rebound path.

## Why Now

The current mainline-gate-failure route can write and commit a backlog Markdown file on `main` during a failed integration. That bypasses the numeric backlog-ID authority, changes the protected shared checkout as a failure side effect, and leaves the originating mission without a safe recovery outcome.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: The named handler and regression coverage bound the change to removing the unsafe mainline side effect and proving the safe outcome.
- Main drivers: protected-main integrity; numeric backlog-ID/schema authority; truthful integration-failure recovery; preservation of bounded mission-only rebound behavior

## Scope

- Remove automatic creation, rendering, staging, and committing of a backlog task from the mainline-reproduced gate-failure route.
- Ensure that route reports its gate evidence and stops without mutating the base worktree.
- Retain the existing bounded rebound path for a gate failure that reproduces only in the mission worktree.
- Add regression coverage for both the unchanged base-worktree outcome and the preserved mission-only rebound outcome.

## Out of Scope

- Changing the numeric `Backlog.md` workflow or authorizing automatic backlog-task creation through a different command.
- Changing integration gate selection, retry limits, or successful-integration behavior.
- Repairing the underlying gate failure that caused an integration attempt to fail.
- Updating unrelated backlog schemas, task identifiers, or mission workflow behavior.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A gate failure reproduced in the primary checkout leaves the base worktree byte-for-byte unchanged and `git status --porcelain` empty; it creates no file and commits no change.
- The integration-failure implementation contains no construction of `TASK-MAINGATE` identifiers and no hand-rendered backlog Markdown for a mainline gate failure.
- A mainline-reproduced gate failure records or reports the gate evidence and terminates the integration attempt without creating a backlog task as a side effect.
- A gate failure that occurs only in the mission worktree still takes the existing bounded rebound path, including its configured retry bound.
- Regression tests cover the primary-checkout no-mutation result and the mission-only rebound result, and the repository verification gate passes.

## Risks and Assumptions

- Assumption: the integration command has distinct mainline-reproduced and mission-only failure routes, as described in the backlog task.
- Risk: removing the unsafe route could discard diagnostic context; retain failure evidence/reporting without materializing it as a backlog task or commit.
- Risk: a test can miss a mutation outside its fixture; assert both a byte-level snapshot and clean `git status --porcelain` for the base worktree.
- Risk: changing shared rebound handling can weaken bounded retries; isolate removal to the mainline-reproduced branch and preserve mission-only assertions.

## Checkpoints

- CP 1: Before changing production behavior, add `test/task-2507-mainline-gate-mutation-repro.test.ts`. Reproduce an integration gate failure that also fails in the primary checkout, and assert that the base worktree snapshot is identical, `git status --porcelain` is empty, no `TASK-MAINGATE-*` file exists, and no commit is created. This test must fail at the mission parent commit (red) because the route writes and commits the synthetic task, then pass after the fix (green).

Reproduction-Test: test/task-2507-mainline-gate-mutation-repro.test.ts

- CP 2: Remove automatic synthetic-backlog creation and commit behavior from the mainline-reproduced failure route while preserving diagnostic evidence and its stop outcome; keep changes confined to the handler and directly related tests.
- CP 3: Extend regression coverage to prove that a mission-only gate failure still follows the existing bounded rebound path, including its retry limit.
- CP 4: Run the required repository gate, inspect the final diff for unintended primary-checkout/backlog mutations, and record durable evidence for every success criterion.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A concise summary of work done.
- A `## Goal Check` heading followed by the exact 3-column table `| Criterion | Evidence | Status |`.
- At least one durable evidence reference for every criterion. Lead with exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`; file:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- For this mission, identify the red-to-green reproduction test at `test/task-2507-mainline-gate-mutation-repro.test.ts`, the test proving the primary checkout is unchanged and clean, the test proving mission-only bounded rebound, and `./scripts/verify-local.sh all` when run.
- Raw `stat`/`ls` output or generic prose alone is not enough. If shell output is included, pair it with an accepted command, exact test name, ADR reference, or test-file path above.
- A non-generic `Next action:` line at the bottom that names the next checkpoint action or verification activity.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Mainline failure does not mutate base worktree | `test/task-2507-mainline-gate-mutation-repro.test.ts`, exact regression test name | PASS |
| Mission-only failure retains bounded rebound | existing rebound regression test path and exact test name | PASS |
| Repository verification completed | `./scripts/verify-local.sh all` | PASS |

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not create, render, stage, commit, rename, or delete backlog task files as a side effect of integration failure handling.
- Do not change the backlog task `assignee` field, backlog numeric-ID authority, `Backlog.md` workflow, or primary-branch protection policy.
- Do not change successful-integration behavior, configured gate selection, or retry bounds outside the mission-only rebound behavior covered by this mission.
- Keep changes limited to the integration failure route and its directly related tests; do not perform unrelated refactors.

## Stop Rules

- Stop and request direction if satisfying the goal requires changing numeric backlog-ID/schema authority or automatically creating backlog tasks through a new authorization path.
- Stop and request direction if the mission-only rebound path cannot be preserved without changing configured retry bounds or integration gate selection.
- Stop and report the conflicting behavior if the primary-checkout no-mutation test conflicts with an explicit, documented integration contract that requires a base-worktree write.
- Stop before broadening the change beyond the named integration failure handler and directly related regression coverage.
