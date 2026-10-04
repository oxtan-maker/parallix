---
id: TASK-2646
title: >-
  Integration-validation skip marker never hits after a rebound because
  bookkeeping commits move HEAD
status: done
assignee: [claude]
created_date: '2026-10-04 10:43'
updated_date: '2026-10-04 10:43'
labels:
  - bug
  - integration
  - performance
dependencies: []
references:
  - src/application/integrate/validation-marker.ts
  - src/application/integrate/gates.ts
  - src/application/integrate-workflow.ts
  - src/adapters/cli/commands/integrate-gate-rebound.ts
  - src/adapters/backlog/task-transitions.ts
priority: high
ordinal: 164008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

When an integration gate fails and the mission is rebounded (TASK-2492/TASK-2620), the implementer's repair is verified by rerunning the full configured preIntegration gate set (about 4+ minutes). After re-review approval, the mission stops for the human (TASK-2620 AC2), and the human's `px integrate` then reruns the entire suite again.

TASK-2625 added a sha-keyed marker (`integration.integration-validation` in `operational_history`, see `src/application/integrate/validation-marker.ts`) so the second run could skip hooks that were already validated. Markers are recorded correctly: the operator DB holds 11 rows, each listing every hook. In practice, though, the skip never applies, because `validationSkipApplies` requires `marker.sha === finalized HEAD` exactly and HEAD always moves before the next integrate:

1. Lane-transition commits (`backlog(<slug>): transition to review ...`, `transition to ready-for-integration`, `chore(<slug>): integrate pre-commit hook`) land on the mission branch on top of the validated commit during the rebound -> re-review -> integration-lane flow. Observed examples:
   - `review/mission/task-2637.04`: marker `b6db1bbd1`, followed by `d0899e62b backlog(task-2637.04): transition to review`.
   - `mission/task-2644`: fix commit followed by three bookkeeping commits.
2. Integration rebases before the gates run, and the skip is keyed on the post-rebase commit (TASK-2625 round-2 F2, which is intentional). Any movement on main, including those same bookkeeping commits, produces a new SHA.

The result is that the skip feature is inert and every rebound costs two full integration suites.

A smaller defect: the comment in `src/application/integrate-workflow.ts` around the `context.missionHeadSha` capture says the marker is keyed on the pre-rebase HEAD. In fact `missionHeadSha` only enables recording; the key is the verify-time `tree.commit`, and lookup uses the post-rebase finalized commit.

## Expected

If the only difference between the validated commit and the finalized integration commit is bookkeeping (Backlog task state), the already-validated hooks are skipped. If production, test, or config content differs (for example, a rebase that brings in real changes from main), the full suite runs as before.

## Constraints

- Keep the resolution general: no special-casing for repository, branch, or mission slug (TASK-2625 SC2), and no special path for Parallix developing itself.
- Preserve F2 safety: a tree that differs in non-bookkeeping content must never skip.
- Fail open to the full suite on any unreadable marker, missing commit, or git error.
- Ports-and-adapters: the skip decision stays pure in the application layer. Git diff inspection is reached through the existing gates or git port, not imported directly.
- Moving lane-transition commits off the mission branch is a larger, boundary-affecting alternative. Do not do it in this mission without an explicit user decision.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused reproduction in the owning validation-marker / integration-gate suite is red on main: a marker at commit A, followed by a commit that only touches backlog/ task files, results in the full gate set running
- [ ] #2 With the fix, the same scenario skips the whitelisted hooks and logs which hooks were skipped and at which validated sha
- [ ] #3 A finalized commit whose diff from the marker sha touches any non-bookkeeping path (src, test, config, workflow.config.json) still runs the full configured suite
- [ ] #4 A rebase onto a main that advanced only by bookkeeping commits still honours the marker; a rebase that brings in non-bookkeeping changes does not
- [ ] #5 Missing marker, unreadable history, unreachable marker sha, or a git diff error all fall back to the full suite
- [ ] #6 The bookkeeping-path definition is a single named, repository-general rule (not a slug, branch, or repo check), and the misleading missionHeadSha comment in integrate-workflow.ts is corrected
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
