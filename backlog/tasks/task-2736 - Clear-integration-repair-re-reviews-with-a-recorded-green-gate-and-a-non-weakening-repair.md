---
id: TASK-2736
title: >-
  Clear integration-repair re-reviews with a recorded green gate and a
  non-weakening repair
status: backlog
assignee: []
created_date: '2026-10-12 16:32'
labels:
  - ai_sdlc
dependencies:
  - TASK-2734
priority: high
ordinal: 234008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When an integration gate revokes an approval and the repair returns to review, the reviewer classifier is asked whether the repair addresses the gate failure. Since 2026-10-10 it has abstained on every integration repair (0 clears, 0 returns in px-0010 telemetry): it cannot see a test run, so it cannot know the failure is fixed, and the packet diffs only cited paths. Parallix already records the authoritative answer to that question: integration validation runs the failed hooks and records them green at a SHA.

px-0010 research (../parallix-research/px-0010/README.md sections 7-9) replaces the question. Parallix supplies the gate result as an execution fact, and the classifier answers only whether the repair weakened or bypassed the checked obligation (question I13 v4, kept in ../parallix-research/px-0010/i9-12/questions.mts as WEAKENING_V4).

Rule for an integration-repair round, evaluated after the TASK-2734 unchanged-patch restore and before normal review:
1. Gate fact (I9): Parallix integration validation recorded the failed gate's hooks green, before the review round started, at the candidate or at a revision whose difference from the candidate is Backlog task records only or a rebase that leaves the mission patch unchanged (each side relative to the main commit it is rebased onto, version bump ignored).
2. Repair packet: failed gate name, the extracted failure lines from the retained gate log, the prior-to-candidate diff restricted to files whose mission change differs between the two revisions (token-sized, no byte caps, Backlog records excluded), repair commit subjects, the rebase fact (both main baselines and commits incorporated) and the gate fact under validation.failedIntegrationGateRerun.
3. One Jev call with the I13 v4 question (preserves / weakens / insufficient_evidence). preserves >= 0.60 restores the prior approval; anything else, any failure, a missing fact or an over-budget packet goes to the reviewer. The weakening question never returns a mission on its own.

Statistics from px-0010 (Jev typesafe/jev-1.13-20260917, all states assume TASK-2732):
- Population: 185 historical integration repairs; 51 had a pre-review gate fact (49 labelled used for tuning).
- Tuning, v4 at 0.60: 19 clears, 18 approved by the reviewer, 0 unsafe repair clears. The one non-approved clear (task-2706 r3) cites migration defects already present at the approved revision, outside the repair diff. The prior production-style question (v1 at 0.80) cleared 29 with 2 unsafe repairs (task-2640, task-2653); v4 scores those 0.09 and 0.25.
- Stability: repeat calls on 26 cases with preserves >= 0.3 gave 0 route flips at 0.60 (largest change 0.09); 0.50 and 0.70 each flip single cases.
- Synthetic controls weakens probability: gate exclusion 0.95, uncalibrated CPU budget raise 0.87, deleted assertion 0.55 (weakest control, single hand-built hunk).
- Post-hoc historical set (rounds admitted by landed-equivalence, frozen v4): 20 rounds, 6 clears, all approved, 0 unsafe; the change request (task-2584 r9) scored 0.02.
- Frozen validation on unseen rounds after 2026-10-12T13:02Z: 2 rounds with a gate fact, both cleared (0.65, 0.93) and both approved by the reviewer; the 2 without a fact were changes-requested and correctly left to the reviewer. Both clears are from task-2732, so this is weak independent evidence.
- Production panel on the same validation rounds abstained; on task-2732 r2 its v1 question gave does_not_address 0.85, near the 0.89 return threshold, on a round the reviewer approved.
- Cost: one Jev call per qualifying round (repair packets about 9k-23k input tokens, about USD 0.0004-0.001 per call).
- Low scores on approved rounds fall in three groups: empty mission diff (covered by TASK-2734), CPU budget raises without calibration evidence (blocked by design), and repairs touching src/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An integration-repair round with a qualifying gate fact and v4 preserves >= 0.60 restores the prior approval without a reviewer run; every other outcome (below threshold, weakens, insufficient_evidence, call failure, missing or late fact, over-budget packet) goes to normal review and never returns the mission.
- [ ] #2 The gate fact admits only validation recorded before the round started, for the failed gate's hooks, at the candidate or at a revision differing only in Backlog task records or by a rebase that leaves the mission patch unchanged; any other code change after the validated SHA is not admitted (task-2722 r9 shape).
- [ ] #3 The repair packet carries the failed gate, extracted failure lines, the mission-change-restricted prior-to-candidate diff, repair commit subjects, the rebase fact and the gate fact, sized only by the token budget; the v4 question text and 0.60 threshold are versioned with the policy.
- [ ] #4 The decision is recorded with its own decision source and policy version, citing approved revision, candidate, gate, validation SHA and the preserves probability, and is auditable in review history.
- [ ] #5 Focused owning-suite tests cover: qualifying clear, below-threshold fallback, weakens fallback, call failure, missing fact, fact recorded after round start, code commit after validated SHA, rebase-only and backlog-only relations.
- [ ] #6 px stats reports per period beside the existing classifier rows: integration-repair rounds, rounds with an admissible gate fact, weakening-question calls, clears, clear share, and fallback reasons (no fact, below threshold, weakens, insufficient evidence, failure, over budget).
- [ ] #7 px stats reports observed wrong clears: a cleared round later revoked by a human or followed by changes requested on the same mission before it lands, shown with observed and unobserved clear counts so a zero never appears without its denominator.
- [ ] #8 px stats reports the preserves-probability distribution of clears and fallbacks (count at or above 0.60, 0.40-0.60, below 0.40) so threshold drift is visible without rerunning research.
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
