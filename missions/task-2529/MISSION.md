# Mission: Remove the redundant conflict-agent launch flag (task-2529)

## Goal
Remove the redundant `conflictAgentLaunched` state and its `port.startAgent` wrapper from `rebaseBeforeReviewRound` while retaining the workflow's existing `sharedFileConflicts` result for conflict-resolution-agent runs.

## Why Now
The deletion was deliberately excluded from task-2527 as out of scope, and its prior test passed on the baseline, so it did not prove the cleanup. This focused mission supplies a red-to-green regression test and lands the isolated workflow simplification.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: redundant adapter state, unpinned review-loop invariant, and a previously deferred cleanup from task-2527

## Scope
- Add a focused test in `test/review.test.ts` that starts the `conflict-resolution` agent through the workflow port and proves the reported `sharedFileConflicts` value.
- Remove `conflictAgentLaunched` and the local `port.startAgent` wrapper from `src/adapters/review/rebase.ts` if the test confirms the flag is redundant.
- Retain the existing non-empty-`sharedFiles` condition as the sole basis for `sharedFileConflicts`.

## Out of Scope
- Changing conflict classification, auto-resolution, agent-launch ordering, or the `sharedFiles` lifecycle in `src/application/rebase-workflow.ts`.
- Refactoring unrelated review-loop adapters or changing review-loop user behavior.
- Documentation changes unless the implementation uncovers a durable behavior change.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `test/review.test.ts` contains a test that launches `conflict-resolution` through the workflow port and asserts `sharedFileConflicts`; it fails against the mission parent commit and passes after the removal.
- `src/adapters/review/rebase.ts` no longer declares `conflictAgentLaunched` or replaces `port.startAgent` with a wrapper in `rebaseBeforeReviewRound`.
- For the test scenario that launches `conflict-resolution`, the resulting `sharedFileConflicts` remains `true` because the workflow retains non-empty `sharedFiles`.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` exit zero on the completed mission tree.

## Risks and Assumptions
- Assumption: `conflict-resolution` is launched only after the auto-resolve branch has returned for an empty `sharedFiles` result, and no later path clears that result.
- Risk: a test that merely observes the existing disjunction can pass before the deletion; mitigate by requiring the test to exercise the agent launch and fail at the parent commit.
- Stop if the red test shows `sharedFileConflicts` can become true solely from a launch while `sharedFiles` is empty; retain the flag and record the counterexample.

## Checkpoints
- CP 1: In `test/review.test.ts`, author and run a focused reproduction that launches `conflict-resolution` through the workflow port and asserts `sharedFileConflicts === true`; confirm it is red at the mission parent commit before editing production code.
- CP 2: Remove the flag and `port.startAgent` wrapper in `src/adapters/review/rebase.ts`, then run the focused reproduction to confirm it is green with the same assertion.
- CP 3: Run the required static-analysis and full verification gates; write checkpoint evidence that maps every success criterion to the reproduction test, changed adapter path, or gate command.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion led by durable evidence Parallix verifies today: the exact test name in `test/review.test.ts`, the test file path `test/review.test.ts`, the adapter path `src/adapters/review/rebase.ts`, and recognized commands such as `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh all`, `npm ...`, `node ...`, `git ...`, or `px ...`. Cite an ADR reference when relevant. File:line references are accepted but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with one of the accepted references above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Regression test is red before the fix and green after it | `test/review.test.ts`, exact reproduction test name | PASS |
| Redundant wrapper is removed | `src/adapters/review/rebase.ts` | PASS |
| Required verification completed | `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter `src/application/rebase-workflow.ts` unless the red reproduction disproves the documented launch invariant.
- Do not change conflict-resolution agent behavior, review-round sequencing, or unrelated adapter wrappers.
- Do not add dependencies or change user-facing documentation for this internal cleanup unless a durable behavior change is discovered.

## Stop Rules
- Stop implementation and record the finding if the focused reproduction cannot fail at the mission parent commit.
- Stop implementation and retain the existing code if an agent launch can produce `sharedFileConflicts === true` while `sharedFiles` is empty.
- Stop and seek scope direction if satisfying the test requires edits outside `test/review.test.ts` and `src/adapters/review/rebase.ts`.
