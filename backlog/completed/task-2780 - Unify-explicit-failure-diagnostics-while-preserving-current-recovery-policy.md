---
id: TASK-2780
title: Unify explicit failure diagnostics while preserving current recovery policy
status: done
assignee: [codex]
created_date: '2026-10-19 09:53'
labels: []
dependencies: []
ordinal: 261008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Remove the competing explicit-diagnostic definitions in src/domain/failure-classification.ts so direct classification and structured rebound agree on recognized infrastructure and state-machine failures.

Context:
Read ADR 0048, including TASK-2494 and TASK-2663, and preserve ADR 0051 and ADR 0059 boundaries. Account for TASK-2497's missing-implementer diagnostic and later TASK-2642, TASK-2700 and TASK-2766 recovery fixes. TASK-2765 removed oversized launch snapshots.

Success criteria:

1. One rule definition owns explicit blocker recognition. Both task state invalid and the missing recorded implementer diagnostic return StateMachineViolation/HumanOnly through direct classification and structured gate/hook rebound, without launching a repair agent.
2. Preserve the deliberate distinction between explicit blockers and the classifier's conservative unknown-error fallback. Otherwise repairable structured failures still follow their structured defaults; passing test titles do not create blockers; genuine failures and agent-capacity precedence retain current behavior.
3. Preserve fresh bounded repairs, retained diagnostics, exact authorized verification, invalid-contract escalation and automatic handoff/review continuation restored by TASK-2766. Keep the separate operator-started fleet investigation policy unchanged.
4. Extend the existing rebound-kernel and handoff-repair contracts with focused red-to-green evidence, then remove the duplicate rule. Keep prompt composition, lifecycle transitions, budgets and gate configuration outside this change. Follow current AGENTS.md verification instructions.
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
