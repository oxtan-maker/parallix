---
id: TASK-2231
title: unit tests hangs
status: done
assignee: [claude]
created_date: '2026-07-12 05:18'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
unit tests sometimes hang at 

startAgent launch failure with signal retries next agent (113.41924ms)
✔ resolveNoOutputWatchdogConfig returns draft-specific defaults when step is draft (0.227286ms)
[INFO] Selected agent for step "draft": custom (opencode)
[INFO] Launching: opencode run --pure --dangerously-skip-permissions --format json Do not spawn more than 2 parallel subagents. If you need more, pause and wait.
Execute.
[INFO] Working directory: /tmp/agents-draft-pwd-bn3vXn
✔ draft launch shows agent-stage in no-output watchdog messages (254.454726ms)
{"cwd":"/tmp/agents-draft-pwd-bn3vXn","pwd":"/tmp/agents-draft-pwd-bn3vXn"}✔ draft launch preserves the mission worktree in cwd and PWD for child CLIs (49.848818ms)
✔ non-draft launch uses generic no-output watchdog (256.675529ms)

check that no missing mock is starting something expensive
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
