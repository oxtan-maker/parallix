---
id: TASK-2312
title: labelling has broken
status: done
assignee: [custom]
created_date: '2026-07-25 19:28'
labels: [ai_sdlc, bug]
dependencies: []
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every mission recently (2 days ago - 7 days ago) are broken are not able to draft - > active ->  review -> ready for integration -> done

since the label seems to have a systematic error shown during integration 

[INFO] Integration preflight for task-2311
[PASS] Mission branch: mission/task-2311
[PASS] Mission doc: /home/magnus/code/parallix-task-2311/missions/task-2311/MISSION.md
[PASS] Backlog task: task-2311 - after-pi-tech-change-console-is-empty.md (ready-for-integration)
[FAIL] Backlog classification: Missing or invalid classification for task-2311; expected exactly one of ai_sdlc, user_value, or unknown in the labels of /home/magnus/code/parallix/backlog/tasks/task-2311 - after-pi-tech-change-console-is-empty.md. Fix: add exactly one of those labels and do not use a separate frontmatter field for mission type.
[PASS] Backlog status: approved
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
