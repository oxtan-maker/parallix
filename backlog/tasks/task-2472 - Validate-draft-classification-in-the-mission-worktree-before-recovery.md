---
id: TASK-2472
title: Validate draft classification in the mission worktree before recovery
status: backlog
assignee: []
created_date: '2026-09-09 00:00'
labels:
- ai_sdlc
- bug
dependencies: []
---

## Description

`px draft task-2471` accepted the draft agent's `user_value` label in the mission worktree, then reported that the primary checkout's task had no classification and relaunched the agent. The retry repeated the same failure, even though the worktree task was valid.

Make post-draft classification validation and recovery use the same authoritative mission-worktree task file the agent edits. Synchronize valid labels to the primary checkout before any later primary-checkout consumer needs them, and cover the mismatch with a focused regression test.

## Definition of Done

- [ ] #1 A valid classification label only in a mission worktree completes draft without an unnecessary recovery launch
- [ ] #2 The classification label is synchronized to the primary checkout
- [ ] #3 A missing or invalid mission-worktree label triggers one focused recovery launch and then fails clearly if still invalid
