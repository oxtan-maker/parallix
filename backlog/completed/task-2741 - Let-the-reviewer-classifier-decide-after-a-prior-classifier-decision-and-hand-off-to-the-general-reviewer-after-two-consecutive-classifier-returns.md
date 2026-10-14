---
id: TASK-2741
title: >-
  Let the reviewer classifier decide after a prior classifier decision, and hand
  off to the general reviewer after two consecutive classifier returns
status: done
assignee: [codex]
created_date: '2026-10-14 09:40'
updated_date: '2026-10-14 09:54'
labels:
  - ai_sdlc
dependencies: []
priority: medium
ordinal: 236008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today `decideAndCommit` (src/application/review-classification/classify-review.ts) sends every round to the general reviewer whenever the prior decision came from the classifier (`original?.classifier` → `prior-classifier-review`). The rule exists so that Jev cannot keep a mission in a loop of wrong returns on a correct fix. It also blocks safe clears. In px-0010 follow-up telemetry (2026-10-12 to 2026-10-14), task-2734 r4 was an integration repair with a qualifying gate fact (rebase-only from the validated SHA). The frozen v4 weakening question scored it preserves 0.94, but it went to the reviewer only because r3 had been cleared by the classifier. The reviewer approved it.

Replace the blanket rule with a bound on consecutive classifier returns:
- A prior classifier clear does not block the classifier on the next round.
- A prior classifier return to the implementer does not block the next round either. After two consecutive classifier returns on the same mission, with no general-reviewer decision in between, the next round goes to the general reviewer.

The classifier judges against what the general reviewer described: its findings and comment, or the gate revocation. No extra provenance chain is required.

Evidence: ../parallix-research/px-0010/README.md section 12 and v4-validation/work/responses/task-2734-r4.json.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A round whose prior decision was a classifier clear is classified normally (findings panel, weakening question or unchanged-patch restore) instead of falling back with prior-classifier-review.
- [ ] #2 After two consecutive classifier returns to the implementer on one mission, with no general-reviewer decision between them, the next round goes to the general reviewer with a distinct recorded fallback reason; a general-reviewer decision resets the count.
- [ ] #3 Focused owning-suite tests cover: clear after a classifier clear, a return after one classifier return, a fallback after two consecutive returns, and a reset by a general-reviewer decision.
- [ ] #4 Classifier telemetry and px stats show the new fallback reason separately from the other classifier fallbacks.
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
