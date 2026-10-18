---
id: TASK-2772
title: Show actionable workflow failure summaries after verbose command output
status: done
assignee: [codex]
created_date: '2026-10-18 05:01'
labels:
  - enhancement
dependencies: []
priority: medium
ordinal: 255008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a repository command emits large output, the actionable failure can disappear above coverage tables or other trailing reports. In TASK-2762, test CPU-budget violations and a timeout were followed by a long coverage table and the generic message "Workflow exited with status 1". The operator had to investigate whether this was a crash, a failed verification command, or exhaustion of automatic recovery.

Improve the general Parallix failure presentation for any repository and configured command. After command output finishes, show a concise final summary identifying the failed stage and command, observed exit code or signal, available diagnostic evidence, recovery outcome, and the next operator action. Keep complete output accessible through a concrete retained-log reference. Distinguish test resource-budget failures from agent recovery/rebound-budget exhaustion when evidence supports that distinction; otherwise report the cause as unknown rather than guessing.

This is a product improvement applicable to arbitrary projects. Do not introduce a Parallix-self-development mode, repository-name checks, or a dependency on Parallix-specific test reporters. Keep gates, budgets, retry policy, and failure semantics unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A failed command followed by verbose trailing output ends with a concise, visible summary naming the workflow stage, command, and exit code or signal.
- [ ] #2 The summary includes available actionable diagnostics and a concrete reference to complete retained output; unknown causes are reported honestly.
- [ ] #3 The summary explains whether recovery was attempted, why it stopped, and the supported next action; it distinguishes command/test budgets from recovery-budget exhaustion when known.
- [ ] #4 Behavior works for arbitrary repositories and command output without self-development special cases or mandatory test-runner integrations.
- [ ] #5 Focused regression coverage retains diagnostics before a long trailing report and covers command failure, timeout or signal, and recovery exhaustion without changing gates, budgets, or retry policy.
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
