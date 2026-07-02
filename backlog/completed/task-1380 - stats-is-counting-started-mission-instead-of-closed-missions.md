---
id: TASK-1380
title: stats is counting started mission instead of closed missions
status: done
assignee: [custom]
created_date: '2026-06-27 14:33'
updated_date: '2026-07-02 05:30'
labels: [bug, user_value]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
We need to add a closed column to the stats file to ensure we are not counting started but not completed missions in stats. Also update the existing stats file in ~/.local/state/parallix so (most missions are marked as done, only the active are not and the active are not counted)
<!-- SECTION:DESCRIPTION:END -->

## Review History

### Round 1 — claude requested changes (2026-07-02)
- **Finding 1 (CRITICAL):** `normalizeStatsRow`'s `closed: 'yes'` default leaked into the write path, causing `recordActiveStats`/`recordStageStats`/`recordReviewStats` to write `closed: 'yes'` on in-progress rows. Fixed by moving the default to `loadStatsCsv` legacy migration only.
- **Finding 2 (minor):** `docs/use-cases.md:56` still described 21-column schema. Updated to 22 columns.

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
