---
id: TASK-2743
title: >-
  Ask a measured-limit weakening question when the integration-repair weakening
  question does not clear
status: done
assignee: [codex]
created_date: '2026-10-14 10:11'
labels:
  - ai_sdlc
dependencies: []
priority: medium
ordinal: 238008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2736 clears an integration-repair re-review when the failed gate was recorded green before the round (I9 gate fact) and Jev answers the I13 v4 weakening question with preserves >= 0.60. v4 treats almost every CPU-budget or other resource-limit raise as weakening. Across the px-0010 data, 20 of 57 gate-fact rounds raise a limit, and v4 cleared 2 of the 18 that the reviewer approved.

px-0010 research (../parallix-research/px-0010/README.md section 12, harness and freeze in budget/) adds a second question, WEAKENING_V5 (budget/questions.mts). It is v4 with the budget sentence replaced by a repository-neutral rule:
- A raised resource limit (time, CPU, memory, size or deadline) preserves the check only when the failure lines report a measured overrun for the check that failed, the raised entry is that check's limit, and the new limit is finite and at most about twice the measured value.
- Commit messages are implementer claims and never replace a measurement.
- Removing a limit, raising an entry that did not fail, or lowering a quality bar (coverage, lint, complexity, severity, required counts) is weakening.

Policy, frozen 2026-10-14 in budget/freeze.json: ask v4 first. If v4 does not clear (selected preserves and preserves >= 0.60), ask V5 on the same packet, using the same rule. Anything else goes to the reviewer. The weakening path never returns a mission.

Evidence (Jev typesafe/jev-1.13-20260917, production `failureLines`):
- Tuning set, 57 gate-fact rounds: approved clears go from 22 to 30 of 49, with no new clear on a changes-requested round. The one existing exception is task-2706 r3, whose finding concerns code outside the repair. All 6 synthetic weakening controls stay below 0.60: a 33x raise, raising an entry that did not fail, no measurement, a removed limit, a lowered coverage threshold, and a raise plus a skipped test.
- Holdout, 20 post-hoc rounds: approved clears go from 6 to 7 of 18; the change-requested rounds score <= 0.04.
- Repeat stability: one V5 repeat flipped 2 rounds that sit at the threshold (0.61 to 0.59 and 0.66 to 0.56).
- Rejected variant: putting repair commit bodies in the packet. Jev trusts implementer-written measurement claims (a raise with no measurement scored 0.97).
- Expected gain: about 1 to 2.5 extra clears a week, which is about 5 to 20 reviewer-minutes. V5 adds one Jev call on about half of the fact rounds, at about USD 0.0005 each.

The wording and the twice-measured margin were fixed before the holdout run and were not tuned on it. A frozen validation on new rounds runs alongside production statistics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An integration-repair round with a qualifying gate fact whose v4 answer does not clear is asked WEAKENING_V5 on the same packet; it is restored only when V5 selects preserves with preserves >= 0.60, and every other outcome goes to normal review without returning the mission.
- [ ] #2 A round that v4 clears makes no V5 call.
- [ ] #3 The V5 question text is versioned with the policy, and the decision records which question cleared, its preserves probability and both policy versions, auditable in review history.
- [ ] #4 The packet carries no repair commit bodies.
- [ ] #5 Focused owning-suite tests cover: v4 clear with no V5 call, v4 fallback with a V5 clear, v4 and V5 both falling back, a V5 call failure, and a V5 selection other than preserves at or above the threshold.
- [ ] #6 px stats reports, beside the existing weakening rows, how many V5 calls were made, how many cleared, and the V5 preserves distribution (>= 0.60, 0.40-0.60, < 0.40).
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
