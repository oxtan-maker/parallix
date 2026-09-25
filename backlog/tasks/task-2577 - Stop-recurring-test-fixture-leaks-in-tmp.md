---
id: TASK-2577
title: Stop recurring test fixture leaks in /tmp
status: backlog
assignee: []
created_date: '2026-09-25 12:24'
labels:
  - bug
  - tests
  - resource_usage
dependencies: []
priority: high
ordinal: 108008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On 2026-09-25, /tmp reached 16 GiB/16 GiB and made the agent-smoke gate fail with ENOSPC. A safe sweep removed 24,988 aged project test directories and restored about 11 GiB free. Existing TASK-2318 and TASK-2327 are completed, but current runs still leave thousands of directories. The largest observed family was px-measure-*: test/measurement-store-cutover.test.ts closes stores but retains each temporary SQLite database directory. Other recurring families include task-2521.04-*, qwen-*, px-target-home-*, and task-2339-*. Trace each creator and runner cleanup path before editing; distinguish expected live artifacts from leaks. This mission concerns test scratch space only. TASK-2554 separately addresses fixture rows in the operator database.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduce and measure residual /tmp fixture directories and bytes after a focused run of each implicated test family; identify their creator and cleanup owner.
- [ ] #2 Close SQLite handles before removing measurement-store fixture roots, including WAL and SHM files; a focused rerun leaves zero new px-measure-* directories.
- [ ] #3 Repair the other confirmed fixture families at their shared creation or runner boundary, with cleanup on success and failure; do not delete live tests or migration backups.
- [ ] #4 A repeat run and an interrupted-child check leave no new orphaned project fixture directories; test hygiene reports the offending prefix when this regresses.
- [ ] #5 Required verification, including static analysis, passes on the final tree.
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
