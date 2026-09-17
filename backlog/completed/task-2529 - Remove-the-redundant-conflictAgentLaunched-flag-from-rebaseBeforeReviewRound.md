---
id: TASK-2529
title: Remove the redundant conflictAgentLaunched flag from rebaseBeforeReviewRound
status: done
assignee: [custom]
created_date: '2026-09-17 05:17'
labels:
  - ai_sdlc
  - cleanup
  - review-loop
dependencies: []
priority: low
ordinal: 89007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`rebaseBeforeReviewRound` in `src/adapters/review/rebase.ts` wraps `port.startAgent` to set a `conflictAgentLaunched` flag, then computes `sharedFileConflicts` as `sharedFiles.length > 0 || conflictAgentLaunched`.

Round 4 of the task-2527 review established that the flag is redundant rather than load-bearing: in `src/application/rebase-workflow.ts` the `conflict-resolution` agent is started only after `conflictResult.sharedFiles.length === 0` has been ruled out (the auto-resolve branch returns first), and no later path clears `sharedFiles` — the last write is `conflictResult.sharedFiles = unclassified` before the agent runs. So whenever `conflictAgentLaunched` could be `true`, `sharedFiles` is already non-empty and the disjunction changes nothing.

task-2527 carried this deletion but was asked to drop it as out of scope, and the accompanying test passed against the unmodified baseline, so it pinned nothing. This task exists so the cleanup can land on its own with coverage that actually fails first.

The change was reverted out of `mission/task-2527`; see `missions/task-2527/CP-16.md` and the round-4 findings in `missions/task-2527/review-events/`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A test in `test/review.test.ts` launches the `conflict-resolution` agent through the workflow port and asserts the resulting `sharedFileConflicts` value; the test fails against the current `src/adapters/review/rebase.ts` and passes after the change
- [ ] #2 The `conflictAgentLaunched` flag and the `port.startAgent` wrapper are removed from `rebaseBeforeReviewRound`, or the investigation concludes the flag is load-bearing and the task is closed with that finding recorded
- [ ] #3 `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` exit zero
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
