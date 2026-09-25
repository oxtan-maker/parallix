---
id: TASK-2569
title: >-
  Backup retention deletes freshly returned snapshot when legacy suffix sorts
  later
status: done
assignee: [codex]
created_date: '2026-09-24 18:20'
labels:
  - bug
  - user_value
  - persistence
  - backup
dependencies: []
priority: high
ordinal: 102008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SqliteDatabaseAdapter.backup() returned /home/magnus/.local/state/parallix/parallix.db.bak.1790274036750 during TASK-2521.06 backup/restore verification, but the file was already absent when the caller copied it. Existing parallix.db.bak.pre-fix-1789884669* files sort after numeric timestamp suffixes. pruneOlderBackups currently selects files by broad .bak. prefix and lexical order; it can prune the just-created numeric snapshot while returning its path. Scope retention to valid timestamped snapshots or guarantee the newly created file is retained, then add a regression with a pre-fix backup and verify the returned file exists and restores successfully.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
