---
id: TASK-2419
title: >-
  px status reports the PR of the current branch instead of the requested
  mission
status: backlog
assignee: []
created_date: '2026-08-26 14:40'
labels:
  - user_value
  - bug
dependencies: []
ordinal: 120917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px status <slug>` prints the Forgejo PR of whatever branch the command runs on, not the PR of the requested mission.

Observed 2026-08-26 from `/home/magnus/code/parallix-task-2402` (branch `mission/task-2402`): `px status task-2411`, `px status task-2358` and even `px status task-9999` all printed `Forgejo PR: #339 (open)`, which is task-2402's PR.

`StatusCommandUseCase.execute` (`src/application/status-command-use-case.ts`) resolves the mission from `resolvedSlug` but then calls `this._pr.getPrInfo(branch)` with the current git branch. It should look up the PR for the requested mission's branch (`missionBranchName(resolvedSlug)`, as the older `src/adapters/cli/commands/status.ts` path does).

Every other mission-specific line in the output is already keyed by slug, so a wrong PR number next to the right mission is actively misleading — it can point an operator at another mission's review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 px status <slug> run from an unrelated branch or worktree reports the PR of <slug>'s mission branch
- [ ] #2 px status <slug> for a mission with no PR reports no PR rather than the current branch's PR
- [ ] #3 A test covers px status for a slug other than the mission of the current branch and asserts the PR lookup uses the requested mission's branch
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
