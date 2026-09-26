---
id: TASK-2578
title: Restore live pre-integration gate TUI and identify the regression
status: backlog
assignee: []
created_date: '2026-09-26 05:44'
labels:
  - bug
  - cli
  - tui
dependencies: []
priority: high
ordinal: 109008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Restore the live pre-integration gate list during interactive px integrate. The operator reports that the dashboard worked immediately after TASK-2558 (parallel integration gates), then disappeared soon afterwards; most runs now appear stuck after pre-commit output while verification runs.

Reported on mission/task-2554: px integrate rebases successfully, prints "Pre-commit hook completed: ./scripts/bump-version.sh" and "[bump-version] 1.5.178 -> 1.5.179", but does not show the running gate list. Reproduce through the actual CLI in a terminal, including auto-rebase and pre-commit, rather than only invoking the gate runner.

History inspected for September 24–26, 2026: TASK-2558, commit 5747d40fc (September 25 07:14 +0200), introduced GateDashboard and parallel gate execution; its recorded assignee is codex. The dashboard eligibility condition still requires stdin/stdout TTY, stdin not raw, and the default log/error callbacks. Parallel execution without an eligible dashboard suppresses start/completion progress through compact mode, leaving only the final summary. This explains a potential silent fallback, but the actual trigger has not been reproduced.

Subsequent relevant changes include TASK-2565 (8750b7e20, integration lifecycle/rebound wiring), TASK-2551 (a9a4e57e8, CLI/integration changes), and TASK-2573 (eabd946d8, clean-tree gate proof reuse). The dashboard eligibility condition was not changed by these later commits. Do not attribute the regression to a mission or agent without a failing reproduction and historical comparison. Find the first bad commit and identify its mission and recorded implementer, distinguishing Git author from agent identity.

Scope: restore reliable interactive gate presentation and useful live progress when the dashboard cannot run; retain parallelism, dependencies, cancellation, output details and mandatory gates. No fix was applied during this investigation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduce the missing gate list through the real interactive px integrate entry point, including the reported rebase and pre-commit path.
- [ ] #2 Identify the first bad commit and its mission/recorded agent using the TASK-2558 working baseline; document evidence and any remaining uncertainty.
- [ ] #3 Interactive integration continuously shows waiting, running, passed and failed gates with elapsed time; details and cancellation remain usable.
- [ ] #4 If interactive dashboard eligibility fails, emit live gate progress rather than remaining silent until the final summary; redirected output stays readable.
- [ ] #5 Add a regression check covering terminal eligibility and the actual CLI presentation boundary without real Forgejo calls; preserve gate ordering and parallel execution.
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
