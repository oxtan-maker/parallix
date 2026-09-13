---
id: TASK-2503
title: Preserve mission identity during rebase
status: backlog
assignee: []
created_date: '2026-09-13 00:00'
labels:
  - bug
  - workflow
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rebase must retain the mission's recorded implementer before replaying commits. A stale mission branch can temporarily expose older task metadata during replay; shared-file conflict recovery must still launch the recorded implementer and must never describe that local workflow condition as a Forgejo or network failure.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 A regression test covers metadata changing during rebase
- [ ] #2 Shared-file recovery keeps the implementer captured before rebase
- [ ] #3 Local metadata failures do not report an infrastructure blocker
<!-- DOD:END -->
