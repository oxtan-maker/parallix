---
id: TASK-2670
title: Keep mission terminal open through integration and show final stats
status: done
assignee: [codex]
created_date: '2026-10-06 13:57'
updated_date: '2026-10-06 14:08'
labels:
  - bug
  - user_value
dependencies: []
references:
  - TASK-2658
  - src/composition/mission-terminal.ts
  - src/adapters/process/tmux-host.ts
priority: high
ordinal: 185008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed during TASK-2658: `npm run dev -- review --start` printed the mission-terminal attach hint and then `[terminated]`. The review itself completed, applied one correction and approved the mission, but the operator lost the terminal view while the mission was only ready for integration.

Keep the operator in the same mission tmux session across review completion and integration, at least until the mission has landed on the local main branch. Review approval alone must not end the operator session. Preserve operator control over starting integration and existing gates, review authority and merge semantics.

After integration, show the user the integration result and current repository statistics through the existing application statistics path. The statistics must remain visible or recoverable after session completion or reattachment; a terminal disappearing must not hide them. Retain the final result/stats view instead of replacing it with an unexplained termination message. Missing observations remain explicitly unavailable.

Scope: terminal lifecycle and user-visible completion/stats presentation. Reuse existing mission lifecycle, terminal-host and stats ports. Do not add Forgejo-to-statistics coupling or change decision counting, Jev routing, integration gate selection or automatic integration policy.

Create a focused reproduction in the owning terminal/workflow suite: the prior behavior loses the attached terminal after successful review, while the fixed behavior remains attached through integration and retains the final stats. Follow ADR 0057; real tmux boundaries use the existing local integration category with finite CPU/wall budgets and isolated cleanup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A successful review leaves the operator attached to a usable mission terminal while the mission awaits integration; normal review completion does not produce an unexplained session termination.
- [ ] #2 The same mission terminal remains usable through operator-triggered integration until successful landing on local main is confirmed; a PR approval or integration start alone is not treated as completion.
- [ ] #3 Successful integration displays a clear final result and repository statistics from the existing statistics application path, including existing PR decision/classifier counts when available.
- [ ] #4 The final integration result and stats remain visible or recoverable after session completion or reattachment, regardless of terminal cleanup; missing statistics are marked unavailable rather than invented.
- [ ] #5 Failed or interrupted integration leaves its actual state and diagnostic visible without claiming that main was updated. Existing detach/reattach controls and operator integration choices remain available.
- [ ] #6 A focused red-to-green reproduction is retained in the owning terminal/workflow suite, with isolated fixtures, finite CPU/wall budgets and checks covering normal review completion, integration completion and retained stats.
- [ ] #7 Preserve typed application ports, composition authority, existing review/gate/merge semantics and local statistics authority; update relevant live operator documentation and run focused docs checks.
- [ ] #8 Real tmux reproductions cover both premature exit after review and terminal loss during failing integration gates; gate names, exit codes and captured output remain accessible after process/session exit. Demonstrate the repaired operator flow with the real terminal adapter.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Second operator report (2026-10-06): the tmux session terminated again during integration, hiding failing unit tests and at least one integration test. Treat terminal termination at normal review completion and loss of the integration failure/output view as separate P0 candidates requiring reproduction and diagnosis. Repair the real tmux flow, including child exit, failed gates, detach/reattach and output retention; successful mocked host tests alone are insufficient. Keep this follow-up on main rather than rebouncing TASK-2658 for terminal work.

Bounce-back diagnosis: TASK-2658 was already moved to active by the integration attempt. The lifecycle transition therefore appears to have succeeded before terminal loss. Reproduce the sequence failing gate -> integration-to-active transition -> repair handoff/child/session exit, and determine which process terminates the operator terminal. Keep the failure evidence accessible across that transition.

Original tmux inspection: socket /run/user/1000/parallix-terminal/233bbddb32ac/task-2658.sock still serves session task-2658, but only an empty console pane remains. Operation pane and scratch state were removed. Current host completion explicitly kills the operation window; investigate whether attachment exits when its selected window disappears and how to retain/switch to an operator result view. This is evidence of pane loss, not proof of a tmux-server crash. Original durable bounce-back cause identifies integration-local failure in lifecycle-timing-local.test.ts, case R1 production (task-2376): expected ReviewerDecision.decidedAt 2026-01-01T10:30:00Z, actual current wall-clock timestamp. Suite CPU 68671ms / 85000ms: not a CPU-budget failure. Original unit failure cannot be recovered from the retained cause, which stores only one failed gate tail. Require durable per-gate output for all failures. Manual reruns stopped at operator request: unit passed 3380 tests; integration-ci independently failed stats-internals.test.ts R5 (task-2378), same decidedAt versus wall-clock mismatch, CPU 284044ms / 432000ms. These timestamp failures belong to TASK-2658 repair evidence; terminal/output-loss diagnosis remains TASK-2670 scope. Manual logs: /tmp/task-2658-manual-integration-20261006; original operational history export: /tmp/task-2658-original-integration-history.json.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
