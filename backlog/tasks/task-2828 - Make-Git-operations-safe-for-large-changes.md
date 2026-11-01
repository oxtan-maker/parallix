---
id: TASK-2828
title: Make Git operations safe for large changes
status: backlog
assignee: []
created_date: '2026-11-01 07:50'
labels:
  - bug
dependencies: []
priority: high
ordinal: 300024
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Existing Git subprocess output limits can crash mission workflows on large changes. During task-2822 rebase onto main, conflict classification calls detectRebaseState, which runs git rebase --show-current and buffers the entire current commit patch. The patch is 2,320,623 bytes, exceeding the default 1 MiB spawnSync buffer and producing spawnSync git ENOBUFS. A read-only reproduction confirmed this; git rev-parse --verify REBASE_HEAD returns the required commit identity without reading a patch. The faulty query predates this mission (blame: 5d429be22b, 2026-06-25). Audit existing Git boundaries for unnecessary bulk output and unsafe assumptions about output size, preserving complete data where callers require it and actionable recoverable errors where limits apply. Reuse existing owners and keep architecture and operator-owned gates intact.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Rebase state detection and conflict classification succeed for a current commit patch larger than the default subprocess buffer without capturing the patch merely to identify the current commit.
- [ ] #2 Existing Git call sites handling potentially large diffs, status, history, and patches are reviewed; affected owners use bounded metadata queries or complete output handling appropriate to their contracts rather than a blanket buffer increase.
- [ ] #3 Output-limit failures provide actionable diagnostics and preserve repository and paused-operation state; required output is never silently truncated or treated as complete.
- [ ] #4 Focused regression coverage reproduces the original failure on parent behavior and passes with the fix in existing owning suites; manually exercise a large-change rebase in an isolated repository without touching live missions.
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
