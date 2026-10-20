---
id: TASK-2783
title: Complete the three overlapping lifecycle test consolidations
status: done
assignee: [codex]
created_date: '2026-10-19 09:54'
labels: []
dependencies: []
ordinal: 264008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Complete consolidation of these test pairs:

- handoff-use-case.test.ts and mission-handoff-use-case-contract.test.ts
- handoff-transition-idempotency.test.ts and mission-handoff-lane-events-contract.test.ts
- mission-activation-launch-order.test.ts and mission-use-case-persistence-contract.test.ts

Context:
Read TASK-2622.07, TASK-2622.19 and ADRs 0057 and 0063. Preserve later handoff and lifecycle fixes represented by cases added after consolidation, including TASK-2665, TASK-2668.01, TASK-2715 and TASK-2740. Current AGENTS.md governs execution and file limits.

Success criteria:

1. Inspect assertion-level behavior and assign each scenario to one cohesive owning suite. Preserve the union of distinct input, error, state and ordering assertions; matching case names alone do not justify deletion.
2. The audited handoff pair has 37 overlapping named cases, ten names unique to the old suite and two unique to the replacement. Recheck the starting tree and preserve the unique guarantees. Resolve the launch-order fixtures' repair-support difference deliberately.
3. Remove superseded duplicate cases and setup while preserving isolated fixtures, cleanup and the real persistence boundaries that still need coverage. Do not combine unrelated contracts into a giant suite.
4. Update only the existing discovery/category/partition authorities as necessary. All retained cases remain selected in the appropriate current tier, with finite CPU budgets and unchanged gate ownership.
5. Run focused before/after checks for the affected suites, account for every removed scenario and report their measured CPU impact. Do not claim savings from file renaming or add a parallel assertion inventory used for test selection.
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
