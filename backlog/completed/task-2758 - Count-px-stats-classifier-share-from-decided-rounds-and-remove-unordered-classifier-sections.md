---
id: TASK-2758
title: Count px stats classifier share from decided rounds and remove unordered classifier sections
status: done
assignee: [codex]
created_date: '2026-10-15 12:00'
labels:
  - ai_sdlc
  - bug
dependencies: []
priority: high
ordinal: 246008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The operator uses the "PR Classification analysis" re-review row in `px stats` to judge whether reviewer-classifier changes work. The planned validation counts about 120 re-reviews after TASK-2751/2753/2754 land and compares the classifier share with today's 7%. That row has to count decided rounds correctly. The sections the operator never ordered go.

**Bugs in the share (`reviewRounds`, `review-classification/statistics.ts`).** Reconciled against `mission_review_rounds` on 2026-10-15:
1. Rounds are built from classifier telemetry samples, not from decided review rounds. Telemetry starts at 2026-10-06T22:33Z, so the week of 2026-10-02 shows 69 re-review rounds and a 6% share. The database has 193 decided re-reviews there, 4 of them classifier-decided, which is 2.1%. `classifierStatistics` hides its percentage when coverage is partial; `reviewRounds` ignores coverage.
2. Undecided rounds count. The week of 2026-10-09 includes task-2693 r6, task-2715 r5, task-2720 r3 and task-2749 r3, which have samples but no decision.
3. Decided rounds without a sample are missing. In the same week these are task-2668.08 r3 (general reviewer) and task-2738 r7 (mechanical restoration).
4. A round belongs to the week of its latest sample's `observedAt`, not to the week it was decided.

**Remove (operator decision: not ordered, not wanted):**
- The "Observed wrong" column and every observed-wrong figure. That covers `falseClears`, `falseReturns`, `unobserved`, the shadow variants, `wrong`, `observedDecisions`, and the observation writes in `observe-review.ts` and `classify-review.ts`. The figure can never be filled: each classifier decision is written `unobserved` and nothing updates it, so all 13 classifier decisions since 2026-10-07 are unobserved.
- These whole sections:
  - "Integration-repair re-reviews (recorded green gate + weakening question)";
  - "Measured-limit weakening question (V5)";
  - "V5 preserves probability";
  - "Integration-repair fallback reasons";
  - "Observed wrong clears";
  - "Preserves probability of integration-repair rounds";
  - "Integration repair approval restoration".

  Their presenters are `presentation/integration-repair-statistics.ts` and `presentation/integration-restoration-statistics.ts`, with their statistics modules and reader queries.
- Unused code left behind, such as `classifierGroups`, which nothing calls.

The "PR Classification analysis" table (without the Observed wrong column) and "Fallback reasons" stay.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The re-review and first-review rows count decided review rounds from the review-round store (approved or changes-requested, decision time inside the reporting window). Undecided rounds are never counted. A decided round without a telemetry sample still counts in the denominator.
- [ ] #2 Each decided round is attributed to exactly one decider: classifier, mechanical restoration, or general reviewer. Classifier share is classifier-decided rounds divided by decided rounds. Mechanical restorations are shown in their own column and do not count as classifier decisions.
- [ ] #3 Telemetry samples only supply the attempted, fell-back, called and fallback-reason columns. When samples do not cover the whole window, those columns are marked partial with the first sample time. The decided-round share is still shown, because it does not depend on samples.
- [ ] #4 The Observed wrong column, all observation-based wrong/unobserved figures and their observation writes are removed. Existing observation rows may stay in the database unread; no migration deletes data.
- [ ] #5 The seven listed sections and their presenters, statistics modules, reader queries and tests are removed. `classifierGroups` and any other code left without a caller are removed.
- [ ] #6 Bug reproduction in the owning statistics suite: a fixture with a decided round without a sample, an undecided round with a sample, a round decided in one week whose sample falls in the previous week, and a week before telemetry existed. Red on main, green with the fix.
- [ ] #7 Manual check: `px stats` on the operator's database shows, for the week of 2026-10-09, 125 decided re-reviews, 9 classifier-decided and 1 mechanical. For the week of 2026-10-02 it shows 193 decided re-reviews, 4 classifier-decided, with sample columns marked partial. The removed sections are absent.
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
