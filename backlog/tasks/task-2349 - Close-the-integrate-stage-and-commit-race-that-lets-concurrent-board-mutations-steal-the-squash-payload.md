---
id: TASK-2349
title: >-
  Close the integrate stage-and-commit race that lets concurrent board mutations
  steal the squash payload
status: backlog
assignee: []
created_date: '2026-08-09 04:45'
labels:
  - ai_sdlc
  - bug
dependencies: []
references:
  - 'src/adapters/cli/commands/integrate.ts:980'
  - 'src/adapters/cli/commands/integrate.ts:982-987'
  - 6d57896bed622d75d9b44dbcfd86a1973314a882
  - 314ca626cc3e0310d4a317bbd7c1a8dcb167cf37
ordinal: 83900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px integrate` stages the entire squashed mission payload with `git add -A` in the primary checkout (`src/adapters/cli/commands/integrate.ts:980`) and only then creates the landed squash commit (`src/adapters/cli/commands/integrate.ts:982-987`). Between those two calls the index holds the whole mission and is not owned by anything.

Backlog.md's commit helper runs a bare `["commit","-m",message]` with no pathspec (verified in the bundled `backlog.md-linux-x64/backlog` binary: `async commitChanges($,Y){...let J=["commit","-m",$];...}`). Its staging step (`stageBacklogDirectory`) is scoped to `backlog/`, but the commit is not — it commits whatever is already in the index. So any concurrent board mutation against the same repo root (reorder, status transition, archive, from another mission's session) that fires inside the window commits parallix's staged payload under its own message.

Observed on 2026-08-09 with task-2348: the whole mission — `src/adapters/cli/commands/stats.ts`, `test/stats.test.ts`, `test/task-2348-implementer-attribution.test.ts`, `missions/task-2348/*` — landed on main as commit `6d57896be` with the message `Reorder tasks in review` at 06:16:56, interleaved with task-2347.03 and task-2347.07 transitions at 06:15:02 and 06:17:01. Integrate's own `git commit` then found nothing to commit, took the `commitResult.status !== 0` branch, printed "Could not create the squash commit in the local integration checkout." and aborted.

The same defect fires in the opposite direction, and did so while this ticket was being written. This task file was created as an untracked file in the primary checkout at 06:51 on 2026-08-09 and was swept into commit `d9e568809` — `mission/task-2347.07: task-2347.07` — by that mission's own `git add -A`, alongside `missions/task-2347.07/*`, `src/application/projections/board.ts` and eleven other files that do belong to it. An unrelated file in the working tree therefore lands inside a mission's squash commit with no trace in that mission's review surface. This is the concrete scenario acceptance criterion #2 must reproduce.

The failure is inverted and silent: integrate reports failure while the work actually shipped. The natural operator recovery — re-run integrate, or re-draft the mission as lost — is wrong and risks duplicating work already on main. For contrast, commit `314ca626c` carries the same `Reorder tasks in review` message with a backlog-only diff; that is the innocent shape of the same message.

Two fixes are in scope:

1. Eliminate the window in `integrate.ts`. Replace the unscoped `git add -A` plus bare `git commit` with a commit that names the paths it intends to land, so an interloping bare commit cannot carry parallix's payload and parallix cannot carry a concurrent mutation's files.
2. Make the failure honest. Before aborting on a non-zero commit status, check whether HEAD already contains the payload; if it does, report that the work landed (naming the hijacking commit) instead of reporting a failed integration. This is worth having independently of fix 1, because Backlog.md is an external dependency whose commit behavior can regress.

Fix 2 must not paper over genuine commit failures such as a git hook rejection — those still have an empty diff between the intended payload and HEAD and must keep aborting with the existing hook-failure guidance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A test drives `integrate`'s stage-and-commit step with a simulated concurrent bare `git commit -m "Reorder tasks in review"` firing between staging and commit, fails against the current `add -A` implementation, and passes after the fix
- [ ] #2 The landed squash commit in `src/adapters/cli/commands/integrate.ts` commits an explicit set of paths rather than relying on a prior unscoped `git add -A`, asserted by a test that leaves an unrelated dirty file in the primary checkout and asserts it is absent from the squash commit
- [ ] #3 When `git commit` returns non-zero and HEAD already contains the intended payload, integrate reports the mission as landed and names the commit that carries it, instead of printing "Could not create the squash commit"; asserted by a test
- [ ] #4 When `git commit` returns non-zero and HEAD does not contain the intended payload (for example a rejecting git hook), integrate still aborts with the existing hook-failure guidance, asserted by a test
- [ ] #5 `./scripts/verify-local.sh all` passes on the final tree with no new failures relative to the parent commit baseline, and the recorded totals are captured in the final checkpoint
- [ ] #6 Documentation describing the integration commit step matches the shipped behavior
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
