---
id: TASK-1410
title: >-
  Prevent integrate from corrupting main when restoring a dirty integration
  checkout
status: done
assignee:
  - custom
created_date: '2026-07-03 06:40'
updated_date: '2026-07-04 04:42'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - /home/magnus/code/parallix/lib/commands/integrate.ts
  - /home/magnus/code/parallix/lib/core/mission-utils.ts
documentation:
  - /home/magnus/code/parallix/scripts/verify-local.sh
  - /home/magnus/code/parallix/config/integration-pipelines.json
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px integrate` currently runs the squash/closeout flow directly in the primary integration checkout and only warns when that checkout is dirty. In the reproduced `task-1404` incident on July 3, 2026, integrate stashed unrelated local changes from `main`, landed the squash commit, then blindly ran `git stash pop`. The stashed changes overlapped backlog task files that integrate had just moved/edited during closeout, which left `main` with an unmerged index entry for `backlog/archive/tasks/task-1404 - stop-false-Codex-Mistral-autoblocks-and-persist-blocklist-reasons.md`, a deleted tracked `task-1403` file, and a stray untracked `task-1404` task copy.

Concrete code paths involved:
- `lib/commands/integrate.ts`: `stashMainCheckoutIfNeeded()` currently stashes any dirty primary checkout state, while `restoreMainCheckoutStash()` always does a plain `git stash pop` in `finally`.
- `lib/commands/integrate.ts`: the closeout path calls `completeTask()` and `rewriteWorktreePaths()` in the same primary checkout before the stash restore.
- `printIntegrationPreflight()` currently treats a dirty integration checkout as a warning instead of a blocker, even when those dirty paths overlap backlog or mission-owned files that integrate itself will mutate.

This needs a systematic fix so integrate either uses an isolated checkout/patch strategy or refuses unsafe dirty-state restores before it can corrupt `main` again. The goal is to preserve any legitimate local edits safely without ever leaving the primary checkout in an unmerged or partially restored state after integrate exits.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A deterministic regression test reproduces the task-1404 style collision where the primary checkout contains dirty backlog/task edits before integrate runs, and the test fails on current main without the fix.
- [x] #2 Integrate no longer leaves the primary checkout with unmerged index entries, duplicate task files, or deleted tracked backlog files after restoring preserved local changes.
- [x] #3 When the primary checkout has dirty paths that overlap files integrate will mutate during closeout, integrate either blocks before landing changes with a clear recovery message or switches to an isolation mechanism that preserves those edits safely.
- [x] #4 The preservation/restore flow for dirty primary-checkout changes is explicit in logs and documented well enough that an operator can tell whether local edits were blocked, stashed, patched, or restored.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-04: Took over implementer handoff after the review loop failed on missing /tmp artifacts. Existing mission evidence already shows round-1 fixes landed, verification passed in CP-5, and the latest effective review outcome is approved; task moved to ready-for-integration and handoff artifacts recreated.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
