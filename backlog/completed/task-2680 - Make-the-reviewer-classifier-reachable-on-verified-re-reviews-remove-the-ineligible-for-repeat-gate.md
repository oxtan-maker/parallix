---
id: TASK-2680
title: >-
  Make the reviewer classifier reachable on any review round: remove the
  ineligible-for-repeat gate and the repeat-review requirement
status: done
assignee: [claude]
created_date: '2026-10-07 13:02'
updated_date: '2026-10-07 13:03'
labels:
  - user-value
dependencies: []
priority: high
ordinal: 191008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the reviewer classifier exists to cheaply decide review rounds, but `px stats` for 2026-10-01..07 shows it decided only 2 of 35 re-review rounds (6%), and it is structurally unreachable for anything that is not a re-review. 'ineligible-for-repeat' alone sent 8 rounds (23% of all re-review rounds, the largest rule-based fallback) to the general reviewer without the classifier ever looking at them. Other fallback reasons this week: abstention 13, broader-review-obligations 6, classifier-publication-failed 2, missing-or-ambiguous-path 1, no-structural-excerpts 1, prior-classifier-review 1, unavailable 1.

Where: `src/application/review-classification/repeat-review.ts` (`tryRepeatReview`, `repeatSkip`, `repeatShape`, `assessEligibility`; the reason string is also emitted as telemetry), `routing-policy.ts` (`classifyRepeatFindings`), the evidence packet builder, and the suite `test/unit/application/review-classification/repeat-review.test.ts`. Find the call site in the review loop that only invokes the classifier at the re-review boundary.

Current behavior, two separate blockers:
1. Gate on repeat shape. A round is only classified when the stored current round has no decision, its number equals the loop round, there is more than one round, AND (the prior round's recorded implementer response resulted in exactly the current round's subject revision, OR it is a verified integration repair). Any other shape returns 'ineligible-for-repeat' with no classifier call. These stacked preconditions (round-number equality, response-resultingRevision equality, decision-absent check) fail on legitimate re-reviews, e.g. implementer pushed after responding, rounds renumbered or re-opened, response revision not recorded.
2. Repeat-only by design. The classifier is entered only at the verified re-review boundary and is built around judging whether PRIOR findings were resolved. A first review round (no prior round, no prior findings) can never reach it.

Outcome wanted: the classifier is eligible for every review round, first review and re-review alike. Being a repeat review is not a precondition. The classifier, via its own abstention/routing policy, is the only thing allowed to say 'send to the general reviewer'.
- Re-review rounds: every round with prior findings or a revoked integration gate and a candidate revision reaches the classifier. Derive the candidate revision from the actual verified/current revision instead of requiring equality with the recorded response revision.
- First-review rounds: the classifier is called on the candidate revision with no prior-findings scope. The implementer must define what the classifier judges here (for example the candidate diff against the mission's acceptance criteria) and what evidence packet it receives, reusing the existing evidence-packet and routing machinery rather than building a parallel path. Record the chosen design and its rationale in px evidence.
- Remove 'ineligible-for-repeat' entirely; add no replacement catch-all. Keep specific, honestly named skip reasons only for real missing data (no mission store/review evidence, ports unavailable, opted out).
- Rename away from repeat-only naming where the code no longer means repeat (module, function, port and telemetry names), as a cohesive refactor in place, not a file split.

Investigate first: pull the 8 ineligible-for-repeat telemetry rows through px (read-only, no direct DB access) and record which sub-condition tripped for each, so the fix is grounded in real shapes. Do not touch the other fallback reasons unless the same change naturally removes them; if abstention/broader-review-obligations look like further blockers, record that in px evidence and propose follow-up missions.

Architecture note: if making first-review classification requires changing ports-and-adapters boundaries, dependency direction, typed application ports or composition authority, STOP and present measured evidence, alternatives, behavioral risks and a proposed decision to the user before implementing. Otherwise stay inside the existing ports.

Constraints: reviewer-visible text stays generic ('reviewer classifier'; the classifier name is changing). Classifier output must still never be used as evidence for another classifier decision (prior-classifier-review stays). Replace existing guards in place, do not add parallel ones. Production files stay under 500 lines.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Telemetry for the 8 ineligible-for-repeat rounds is analysed through px and the tripping sub-condition per round is recorded as mission evidence
- [ ] #2 A re-review round whose prior round requested changes and whose candidate revision differs from the recorded response revision (e.g. implementer pushed after responding) reaches the classifier instead of falling back
- [ ] #3 A verified integration-repair round still reaches the classifier; an unverified repair keeps its specific 'integration-repair-unverified' reason
- [ ] #4 The 'ineligible-for-repeat' reason no longer exists in code, telemetry values, or live docs; no replacement catch-all skip reason is introduced
- [ ] #5 Rounds lacking real required data (no prior round, no findings, no mission store/review evidence) still fall back with a specific, accurately named reason
- [ ] #6 Classifier output is still never used as evidence for another classifier decision (prior-classifier-review behavior unchanged)
- [ ] #7 Regression cases for each previously-ineligible shape are added to the existing repeat-review suite, red on parent behavior and green with the fix
- [ ] #8 px stats fallback-reason table no longer lists ineligible-for-repeat for new rounds; docs describing classifier eligibility are updated per docs/doc-standards.md and ./scripts/verify-local.sh docs passes
- [ ] #9 ./scripts/verify-local.sh static-analysis passes and the repeat-review suite passes within the 500 ms unit cap
- [ ] #10 Implementer manually exercises a real re-review round end to end (without touching the real stats DB destructively) and records the classifier being called via px checkpoint record
- [ ] #11 A first review round (no prior round, no prior findings) reaches the classifier on the candidate revision; being a repeat review is no longer a precondition anywhere in the eligibility path
- [ ] #12 The evidence packet and routing policy for first-review rounds are defined, covered by tests in the owning suites, and the design rationale is recorded via px checkpoint record
- [ ] #13 Repeat-only naming (module, functions, telemetry labels, docs) is renamed where it no longer reflects behavior, without splitting files and without breaking stored telemetry readers in px stats
- [ ] #14 px stats PR Classification analysis counts first-review and re-review rounds, shows the split by round kind, and no heading, column or denominator says re-review where it covers both
- [ ] #15 Pre-change telemetry rows still appear in px stats as re-review rounds with unchanged counts for past periods; covered by a test in the existing statistics suite
- [ ] #16 The fallback-reasons table covers all classifiable rounds, and the Observed wrong column works for first-review decisions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Stats scope: `px stats` PR Classification analysis is built around re-review rounds only. Owning code: `src/application/review-classification/statistics.ts` and `src/application/presentation/classifier-statistics.ts`. Once first reviews are classified, the 'Re-review rounds' denominator, 'Classifier share of decisions', 'Classifier called share' and the 'Fallback reasons (re-review rounds decided by the general reviewer)' heading are wrong or misleading. Rework them so the denominator is all review rounds that could be classified, split by round kind (first review vs re-review), with column and heading names that no longer say re-review where they cover both. Historical rows recorded before this change are all re-reviews and must keep reading correctly (classify them as re-review, do not drop or reinterpret them). The 'Observed wrong' column must stay meaningful for first-review decisions.
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
