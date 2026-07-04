---
id: TASK-1412
title: mistral and codex getting blocked all the time
status: done
assignee: [custom]
created_date: '2026-07-03 18:47'
labels: [ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
this is I don't know what order of times we run the same mission in order to unblock these agents.

    "mistral": {
      "until": "2026-07-03 20",
      "reason": "exit 1"
    },
    "codex": {
      "until": "2026-07-03 20",
      "reason": "exit 1"
    },

they get blocked all the time. Think hard and fix it properly this time
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
