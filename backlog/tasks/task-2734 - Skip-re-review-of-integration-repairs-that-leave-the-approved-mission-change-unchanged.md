---
id: TASK-2734
title: >-
  Skip re-review of integration repairs that leave the approved mission change
  unchanged
status: backlog
assignee: []
created_date: '2026-10-12 13:40'
updated_date: '2026-10-12 13:40'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 232008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When an integration gate revokes an approval and the repair loop returns the mission to review, Parallix re-runs a full review even when the mission's own change is identical to the change that was approved. px-0010 research (../parallix-research/px-0010/README.md section 9, I15) found 27 of 185 historical integration repairs with an unchanged mission patch: the gate failure was fixed by main through rebase or was a transient failure. With a recorded green run of the failed gate, all 7 such rounds known before review were approved by the general reviewer; every change request on an unchanged patch either lacked a green gate run or cited defects already present at the approved revision.

Rule (mechanical, no classifier or model call): restore the prior approval without a review round when both hold:
1. Unchanged mission change: the candidate's mission patch, each side taken relative to the main commit it is rebased onto, equals the approved revision's mission patch, ignoring Backlog task records (backlog/tasks/, backlog/completed/) and the release version bump made by the integrate pre-commit hook.
2. Gate evidence: the failed integration gate is recorded green by Parallix integration validation at the candidate, or at a revision equivalent under the same comparison, before the decision.

Otherwise the round proceeds to normal review. The decision must be attributable in review history and statistics as its own source (not reviewer, not classifier), cite the approved revision, the candidate, the gate and the validation evidence, and remain auditable. Reuse the existing sha-keyed integration validation and Backlog-only whitelist where possible rather than adding a parallel mechanism.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An integration-repair round whose mission patch equals the approved one and whose failed gate is recorded green restores the approval without a reviewer or classifier call.
- [ ] #2 Any code difference in the mission patch, a missing or failed gate record, or a git error falls back to normal review.
- [ ] #3 Mission patch comparison is relative to each side's main baseline and ignores only Backlog task records and the integrate version bump; paths containing spaces are compared correctly.
- [ ] #4 The restored approval records its own decision source with approved revision, candidate, gate and validation evidence, and is counted separately in px stats.
- [ ] #5 Focused owning-suite tests cover the unchanged, changed, rebased-only, missing-gate-evidence and failed-gate cases.
- [ ] #6 px stats reports unchanged-repair restores per period beside the classifier rows: integration-repair rounds, restores, restore share, and fallback reasons (mission change differs, gate evidence missing, gate failed, comparison error).
- [ ] #7 px stats reports observed wrong restores: a restored approval later revoked by a human or followed by changes requested on the same mission before it lands, with the count of observed and unobserved restores so a zero is never shown without its denominator.
- [ ] #8 px stats reports review work avoided per restore as an estimate labelled as such: the median measured reviewer duration and cost of normal integration-repair re-reviews in the same period, beside the actual restore count.
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
