---
id: TASK-2753
title: Re-review against the last general decision with one question per obligation
status: backlog
assignee: []
created_date: '2026-10-15 09:00'
labels:
  - ai_sdlc
dependencies:
  - TASK-2751
  - TASK-2752
priority: medium
ordinal: 243008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The reviewer-classifier panel (`jev-three-question-51-80-89-v1`) decides almost no re-reviews. In the 11 hours after TASK-2741/2742/2743 merged, it cleared 0 of 16 rounds. It sends about 29k tokens of whole files with a coverage note, so the classifier mostly answers insufficient_evidence. It also asks about the wrong obligation: after a human or operator revoked an approval, it asks about success criteria instead of the human request.

px-0010 (`../parallix-research/px-0010/oc/`, README section 17, design frozen in `oc/freeze.json` before any call) tested a narrower question on 158 historical re-reviews decided by the general reviewer between 2026-10-01 and 2026-10-15:
- **Diff.** Only the change since the last general-reviewer decision: from the head that reviewer judged to the head now under review.
- **Obligations.** The prior round's findings (`## F` sections) when it requested changes. Human or operator notes made since that decision are added as further obligations, so a revoked approval is judged by the human request.
- **Question.** One call per obligation: does the diff address this obligation (addresses / does_not_address / insufficient_evidence)?

Results with typesafe/jev-1.13-20260917, labelled by the general reviewer's decision:
- **Clear at addresses >= 0.97 on every obligation.** 14 clears (9%): 12 approved, 2 changes-requested for new findings only, 0 with a prior obligation left unfixed. At 0.95 there were 19 clears, including 1 wrong clear (task-2639 r2: an ESLint capture still exits early under `set -e`). The highest wrong score over three repeats was 0.96.
- **Return at does_not_address >= 0.97 on any obligation.** 1 return, correct. At 0.95, task-2675 r5 returned at 0.95 while the reviewer approved.
- **Repeat stability.** 28 rounds scoring 0.92 or higher were asked twice more. The spread was at most 0.04 and usually 0.01.

Both bars were chosen after seeing these rounds, so this task starts in shadow mode. The new route records its decision while the general reviewer still decides, and it acts only after the confirmation criterion below is met.

Decisions against the human never matter here. The optimisation is relative to the general reviewer: the route must not clear what the general reviewer would return, and should not return what it would approve.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A re-review qualifies when the nearest earlier decided round was decided by the general reviewer or returned by the classifier with the general reviewer's findings, and at least one obligation exists. Integration-repair rounds without a human or operator request stay with the weakening path.
- [ ] #2 The packet diff runs from the decided revision of the last general-reviewer decision (TASK-2752) to the verified head under review. A round whose prior decided revision is missing (legacy rounds) does not qualify.
- [ ] #3 Obligations are the prior round's findings after changes-requested, plus every human or operator note made since that decision. System notes (cleared stops, invalidated BLOCKED stops) and the workflow trailer are excluded. Success-criteria obligations are no longer used for qualifying rounds.
- [ ] #4 Each obligation gets one decision call with the frozen px-0010 3B reviewer question. The packet carries the obligation text, the prior review comment, the implementer's response and the diff, fitted by TASK-2751's omission order. A missing or failed call on any obligation means abstain.
- [ ] #5 Route: clear when every obligation selects addresses at >= 0.97; return when any obligation selects does_not_address at >= 0.97, naming the failing obligations in the change request; otherwise the general reviewer decides. Both bars live in one policy definition with a new policy version string.
- [ ] #6 Shadow mode is the default. Shadow decisions are stored with the round and its probabilities, and `px stats` reports them against the general reviewer's decision: clears on approved, clears on changes-requested split into new-findings-only and prior-obligation-unfixed (operator-labelled), and returns on approved.
- [ ] #7 A configuration switch makes the route act instead of shadowing. The task documents the switch criterion: at least 50 qualifying shadow rounds decided after this change, with no clear where the general reviewer found a prior obligation unfixed and no return on an approved round.
- [ ] #8 For qualifying rounds this route replaces the three-question panel. Rounds that do not qualify keep their current routing unchanged.
- [ ] #9 Focused owning-suite tests cover: qualification after changes-requested and after a human-revoked approval; obligations built from findings plus human notes with system notes excluded; the diff ends taken from the decided and verified revisions; clear, return and abstain at the bars, including one obligation just below 0.97; a failed call abstaining; shadow mode recording without acting.
- [ ] #10 Manual end-to-end check on a real mission round in shadow mode shows the stored shadow decision and its probabilities.
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
