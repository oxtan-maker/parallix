---
id: TASK-2344
title: Project full review round history into px status
status: done
assignee: [codex]
created_date: '2026-08-06 00:00'
labels:
  - bug
  - user_value
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`prompts/review.md:11-16` tells every reviewer that `px status <slug>` reports "the current round, phase, and disposition, then every prior round with its reviewer and implementer families, verdict, comment, findings, fixes, and pushbacks", and that this history is how review continuity survives a reviewer family being rerouted mid-mission. The command cannot deliver that. It reports the current round only, so the continuity contract in the reviewer prompt is unsatisfiable for every mission.

### Root cause

`ConcreteReviewReadAdapter.toDomainReview()` (`src/adapters/backlog/concrete-review-read-adapter.ts:126-168`) synthesises a domain `Review` from the flat `ReviewState` record, which holds only the current round:

- `src/adapters/backlog/concrete-review-read-adapter.ts:161` returns `rounds: [round]` — a single round, so prior rounds cannot be projected.
- The same builder hardcodes `response: null` (line 154) and `reviewEvents: []` (line 166), and `decisionFromState()` (line 170) always produces `findings: []`.
- `projectReviewHistory()` (`src/application/projections/mission-board.ts:105-124`) derives `findingSummaries`, `fixes`, and `pushbacks` from exactly those fields, so all three are empty by construction.
- `src/adapters/cli/commands/status.ts:266-278` renders `card.reviewHistory` correctly; the printer is fine, the data is starved.

The data itself is already persisted. For `task-2337` the operator database holds six rows in `mission_review_rounds` (round 1 `approved`/`PUSHBACK_ALL`, rounds 2-5 `CHANGES_MADE`, round 6 `fixing`/`BLOCKED`) plus matching `mission_review_findings`, `mission_review_resolutions`, and `mission_review_events` rows, and `SqliteMissionStore` already hydrates all of them (`src/adapters/sqlite/mission-store.ts:161-200`). The board projection discards that aggregate and takes review state from the `ReviewReadAdapter` instead (`src/application/projections/board-readers.ts:123`).

### Required fix

Have `ConcreteReviewReadAdapter.loadReview()` read the persisted mission aggregate — rounds, decisions, findings, implementer resolutions, and review events — rather than synthesising one round from `ReviewState`, so `px status <slug>` prints the full history the reviewer prompt promises. Add a status-output regression test that asserts the rendered `Review:` block for a multi-round mission contains the prior rounds' reviewer/implementer families, verdicts, findings, fixes, and pushbacks.

### Related work

`task-2343` fixes other fields on the same adapter (`pullRequest`, gate, checkpoint parsing) and is in review. Coordinate to avoid conflicting edits in `src/adapters/backlog/concrete-review-read-adapter.ts`; this task owns the review-round history path only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A red-to-green regression test asserts that `px status <slug>` output for a mission with multiple recorded review rounds lists every prior round, not just the current one
- [ ] #2 Each projected prior round carries its reviewer family, implementer family, and disposition
- [ ] #3 Findings recorded for a prior round appear in that round's projected `findingSummaries` instead of an empty list
- [ ] #4 Implementer resolutions recorded for a prior round appear as `fixed:` and `pushback:` lines in the status output
- [ ] #5 `px status <slug>` for `task-2337` shows rounds 1-6 with round 1 `PUSHBACK_ALL` and round 6 `BLOCKED`
- [ ] #6 The reviewer prompt claim at `prompts/review.md:11-16` is satisfied by the command as shipped, or the prompt is amended in the same change to describe what the command actually reports
- [ ] #7 No new read adapter interfaces are introduced; the fix stays within the existing adapter implementation and the mission store it reads
- [ ] #8 Existing tests pass; `./scripts/verify-local.sh all` completes successfully
<!-- AC:END -->

## Out of Scope

- The other projection gaps owned by `task-2343` (`pullRequest`, gate status, checkpoint parsing, SQLite lifecycle persistence)
- Changing the `BoardProjection` or `MissionCard` type shapes
- TUI rendering changes
- Changing how review rounds are recorded; this task only fixes the read path

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
