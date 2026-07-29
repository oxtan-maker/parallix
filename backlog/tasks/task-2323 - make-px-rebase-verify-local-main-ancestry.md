---
id: TASK-2323
title: make px rebase verify selected base ancestry before reporting success
status: backlog
assignee: [custom]
created_date: '2026-07-17 00:00'
labels: [ai_sdlc, rebase]
dependencies: []
---

## Description

`px rebase` reported that it had rebased `mission/task-2225` onto a selected
local base branch, including after agent-assisted conflict resolution, but the
completed branch did not contain that base commit:

```text
git merge-base --is-ancestor <base-branch> HEAD  # exits 1
```

The command must not report a successful rebase unless the selected local base
branch is an ancestor of the resulting mission `HEAD`. That base may be
`main`, but corner cases can select a feature branch instead. Tracking
divergence against `origin/mission/*` is informational and must not be
confused with the local-base postcondition.

## Acceptance Criteria

- [ ] A successful `px rebase` verifies that the resolved local base branch is an ancestor of mission `HEAD` after every conflict-resolution path.
- [ ] If that postcondition fails, `px rebase` exits non-zero with the resolved base, mission HEAD, and a recovery command; it does not report success.
- [ ] Agent-assisted conflict resolution rechecks the same postcondition after `git rebase --continue` completes.
- [ ] The command distinguishes local-base ancestry from `origin/mission/*` tracking divergence in its diagnostics.
- [ ] Regression tests cover clean rebase, conflict-resolved rebase, and a false-success reproduction where the selected base branch is not an ancestor.
- [ ] Relevant rebase tests and `./scripts/verify-local.sh static-analysis` pass.

## Implementation Plan

1. Trace the success paths in `lib/commands/rebase.ts` and identify where agent-assisted resolution returns control.
2. Add one shared local-base ancestry assertion for all successful paths.
3. Emit actionable diagnostics and preserve the paused/failed state on assertion failure.
4. Add focused regression coverage for the false-success case.
