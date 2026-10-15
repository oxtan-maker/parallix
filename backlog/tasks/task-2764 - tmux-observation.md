---
id: TASK-2764
title: tmux observation
status: backlog
assignee: []
created_date: '2026-10-15 13:42'
labels: []
dependencies: []
ordinal: 251008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mission: Fix remaining tmux observation bugs not covered by existing missions. In `tmux-mission-terminal.ts`, distinguish missing servers from permission errors, failed probes and timeouts; never report these as absent. Fix PID-reuse vulnerability: checking a PID against its freshly read start identity does not prove the original process is alive. Use recorded identity or report unknown. Preserve retained history on probe failures. Add red-to-green regression tests and run focused verification plus static analysis.
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
