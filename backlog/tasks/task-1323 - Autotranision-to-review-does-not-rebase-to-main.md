---
id: TASK-1323
title: Autotranision to review does not rebase to main
status: backlog
assignee: []
created_date: '2026-06-17 04:24'
updated_date: '2026-06-23 16:37'
labels: []
dependencies: []
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
See, http://localhost:3300/magnus/parallix/pulls/10 which (wasted) a whole token round on finding that branch was not rebased to main. Ensure that when an agent is ready with active and the handoff to the review starts that somewhere in that process the branch is rebased to local main/parent branch (in accordance with the quite complicated rules that exists for determining that)
<!-- SECTION:DESCRIPTION:END -->
