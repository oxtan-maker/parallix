---
id: TASK-2391
title: Make Bubblewrap support linked-worktree Git mutations
status: done
assignee: [codex]
created_date: '2026-08-21 12:15'
labels:
  - bug
  - user_value
dependencies: []
references:
  - src/adapters/process/bubblewrap.ts
  - src/adapters/process/spawn-tee.ts
  - src/adapters/agents/agents.ts
  - src/adapters/git/agent-worktree.ts
  - test/bubblewrap-guard.test.ts
  - backlog/completed/task-2374 - bubblewrap-guard.md
  - >-
    backlog/completed/task-2383 -
    Review-sandbox-denies-every-agent-its-state-home.md
priority: high
ordinal: 108917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2386 and TASK-2387 independently reproduced the same infrastructure failure: a Bubblewrap-confined implementer can edit its mission worktree but Git cannot create the linked worktree index.lock, so the agent cannot stage, commit, or continue a rebase. Parallix mounts the checkout writable over a read-only host root, while `git rev-parse --git-dir` and `--git-common-dir` resolve outside that checkout under the primary repository `.git/worktrees/` and shared Git storage. The checkpoint repair loop then relaunches agents that can write more files but still cannot commit them.

Make the shared Bubblewrap profile resolve and authorize every Git metadata location required for implementer-side Git operations in a linked mission worktree, without relying on `.git` being a directory inside the checkout. Keep the permission grant bounded to workflow steps that are allowed to mutate the mission branch. Reviewer profiles must remain unable to alter reviewed source, the index, refs, or commits. Preserve the shared launch seam, argument-array construction, fail-closed behavior for a broken guard, and the explicit `PARALLIX_NO_BUBBLEWRAP` escape hatch.

Scope this mission to the Bubblewrap filesystem boundary and its regression coverage. Do not fold in TASK-2386 prompt/watchdog work, TASK-2387 board publication work, or unrelated handoff retry/classification changes. After this fix integrates into friday-08-21, the blocked TASK-2386 and TASK-2387 worktrees can be rebased and resumed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A deterministic regression creates a real temporary linked Git worktree and reproduces the pre-fix index.lock/read-only failure under Bubblewrap.
- [ ] #2 Every Bubblewrap-confined implementer step can run Git operations that mutate its mission branch, including staging, committing, and continuing a rebase, in a linked worktree.
- [ ] #3 Git metadata mounts are derived from Git-resolved absolute paths rather than assumptions about `.git` layout, and mount construction remains argument-array based and correctly ordered for nested paths.
- [ ] #4 The writable grant is limited to implementer-capable workflow steps and the Git metadata needed by the current mission worktree; it does not silently make unrelated host paths writable.
- [ ] #5 Reviewer profiles remain read-only for reviewed source and Git state, with a focused test proving the reviewer cannot stage or commit changes.
- [ ] #6 All agent families continue through the single shared Bubblewrap launch seam; unavailable, explicitly disabled, and broken-guard behavior remains unchanged.
- [ ] #7 Focused Bubblewrap tests and `./scripts/verify-local.sh static-analysis` pass.
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
