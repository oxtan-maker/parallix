---
id: TASK-2847
title: >-
  Make the Backlog task file optional for DB-owned wave children of task-
  missions
status: done
assignee: [codex]
created_date: '2026-11-10 07:56'
labels:
  - ai_sdlc
  - bug
dependencies: []
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Root cause: the `px split` implementation (commit 8bde7fd17, mission px-0030) is incomplete. It allows a `task-NNNN` parent (`requireEligibleParent` in src/domain/mission-wave.ts accepts `task|px`) and mints DB-only children with no Backlog task file, but it made only draft, execute and rebase tolerate a child with no mirror. It left review preparation, the review loop and integrate requiring a task file for every non-`px-` slug, and its tests cover draft, active and rebase only. A `px-` parent's children happened to work because those stages exempt `px-` slugs. TASK-2846.02 is the first `task-` wave child to reach review, and it is blocked there.

Bug found while unblocking TASK-2846.02 (a `px split` child of the Backlog task TASK-2846). A wave child minted from a `task-` parent is DB-owned: it has a Mission record with `waveParentId` set and no Backlog task file (`resolveTaskFile('task-2846.02')` returns `missing` on purpose, because a dotted id never falls back to the parent file). `px draft` and `px active` already cope with that: they read `waveParentId` from the Mission record (`dbOwnedNoMirror`, src/adapters/mission/execute-mission-adapters.ts, draft-workflow-support.ts). Review and integrate do not. They exempt only `px-NNNN` slugs via the slug-only `isDbOwnedPxIdentity`, so for `task-N.NN` children the missing task file is a hard failure and the workflow exits with status 1 ("Workflow exited with status 1" on the Mission card).

Known hard-failure sites: reviewPreparationTaskFailure and the transitionTask-to-review step in src/application/review-preparation-executor.ts; stopsOnMissingTaskFile in src/application/review-loop/review-loop.ts; the task resolution in src/application/integrate/context.ts and the Backlog branch in src/application/integrate/preflight.ts; src/application/integrate/squash.ts re-resolving the task after integration.

Fix: decide "this Mission has no Backlog mirror" from the Mission record (`waveParentId` set), the same rule execute and draft use, through one shared owner rather than a new per-site check or a widened slug pattern. Then audit every place that reads or writes the Backlog task file (status transitions, assignee/implementer/label writes, completeTask, fallback-summary writes, classification reads, recordLifecycleOperation, mirror commits) across review, integrate, rebase, resolve-conflict, startup-preflight, gatekeeper and their adapters, and make the Backlog step optional for a DB-owned Mission with no mirror, while Mission-store state stays authoritative. Backlog-backed `task-N` missions keep the hard failure on a missing file.

Also check the wave parent's end of life: the parent stays a non-executable `backlog` container with its Backlog task file, and the mission must report (not silently change) how that parent task is closed once every child has landed. If nothing closes it today, record that as a finding in the checkpoint evidence rather than expanding this mission.

Out of scope: creating Backlog task files for wave children; changing split conversion, child identities or atomicity; changing behaviour for `task-N` and `px-` missions that are not wave children.

Constraints: reuse the existing no-mirror decision instead of adding a parallel one (replace per-site slug checks in place), extend the owning review-preparation, review-loop and integrate suites, no new verification gates. Bug mission: needs a reproduction that is red on parent behaviour (a wave child with `waveParentId` and no task file reaching review preparation and integrate) and green with the fix. Once landed, TASK-2846.02 resumes from review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A task-N.NN wave child with a Mission record and no Backlog task file passes review preparation, the review loop and integrate without a missing-task-file failure
- [ ] #2 One shared Mission-record rule decides whether a Mission has a Backlog mirror, and the per-site slug-only isDbOwnedPxIdentity exemptions in review and integrate are replaced by it
- [ ] #3 Every Backlog task-file read or write in review, integrate, rebase, resolve-conflict, startup-preflight and gatekeeper is optional for a no-mirror DB-owned Mission and unchanged for a Backlog-backed task-N Mission
- [ ] #4 The existing wave-child coverage (draft, active, rebase) is extended with the later lifecycle stages for a task- parent's child, so the gap px-0030 left cannot recur silently
- [ ] #5 A reproduction is red on parent behaviour and green with the fix, kept in the owning suites
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
