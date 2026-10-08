---
id: TASK-2675
title: Call Jev on every review decision and make its statistics truthful
status: done
assignee:
  - claude
created_date: '2026-10-07 06:19'
updated_date: '2026-10-07 06:25'
labels:
  - jev
  - review
  - stats
dependencies: []
references:
  - src/application/review-classification/routing-policy.ts
  - src/application/review-classification/repeat-review.ts
  - src/application/review-classification/statistics.ts
  - src/application/presentation/classifier-statistics.ts
  - docs/adr/0065-local-review-classification-evidence.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live data (2026-10-06/07) shows Jev has never applied a decision: every PR review round has a NULL classifier_source. Telemetry recorded 9 attempts, 0 classifier calls: 6 broader-review-obligations, 1 missing-or-ambiguous-path, 1 no-structural-excerpts, 1 unavailable. Roughly 42 re-review rounds occurred on those days, so about 33 were never recorded at all because early exits in tryRepeatReview write no telemetry.

Cause 1: hasBroaderReviewObligations (src/application/review-classification/routing-policy.ts, added in 3f64ad9806) requires every path in `git diff prior..candidate` to be cited in the evidence. It was never validated by the TASK-2650 research. After a rebase onto main, prior is not an ancestor of candidate (5 of the 6 blocked rounds), so the diff contains unrelated main commits and the gate fires every time. Decision: remove this gate entirely. Do not replace it with another heuristic in this mission; any future scope policy needs its own research mission using the corrected telemetry.

Cause 2: px stats PR table is misleading. "Applied decisions" counts all PR decisions (reviewer and Jev). "Observed correctness 239/239" is computed over reviewer decisions because unobserved is only counted for Jev decisions, so it reads as perfect with zero Jev decisions. The denominator (re-review rounds) and the not-attempted count are absent, and the table is a raw pipe table.

Scope:
1. Remove hasBroaderReviewObligations and its call site, tests and documentation claims (docs/config.md, ADR 0065 wording amended in place per the ADR rule). The remaining safeguards (revision pinning, complete original finding set, threshold routing, classifier-never-reviews-classifier) stay.
2. Record a telemetry row, with a reason, for every re-review round, including early exits (ineligible context, human feedback, review evidence unavailable, ports disabled), so the denominator is complete.
3. Rebuild the px stats PR section around re-review rounds: re-review rounds; Jev not attempted; attempted then fell back; classifier called; Jev cleared; Jev returned; each as a count and a percentage of re-review rounds; Jev share of re-review decisions; observed wrong (n/a when there are no Jev decisions, never a vacuous 100%). Show fallback reasons in a second small table. Aligned, properly formatted terminal output; unavailable coverage stays labelled, never zero.
4. Refactor tryRepeatReview (src/application/review-classification/repeat-review.ts) into eligibility, decide and commit steps preserving the publish-then-persist drift handling, and remove the duplicate inline validation in applyClassifierReview (src/domain/classifier-review.ts) in favour of assertClassifierReviewSource. Replace the cast-based reviewAtCandidate construction with a typed domain helper.
5. Replace archivedPacketBytes Python-json.dumps emulation and the hardcoded typesafe/jev-1.13 model string in src/application/review-classification/evidence-packet.ts with the real encoded request size, so the budget reflects what is sent.

Out of scope: argmax/probability consistency check in the decision adapter and any threshold change (needs a separate research mission); any replacement scope gate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 hasBroaderReviewObligations and its call site, tests and documentation claims are removed; a rebased-branch repeat review no longer falls back with broader-review-obligations.
- [ ] #2 Every re-review round writes exactly one telemetry row with a reason, including early exits; retries do not double-count.
- [ ] #3 px stats shows per-period re-review rounds, not attempted, attempted-then-fell-back, called, cleared and returned as counts and percentages of re-review rounds, plus Jev share of re-review decisions.
- [ ] #4 Observed wrong is unavailable when there are no Jev decisions; a table with zero Jev decisions never reports a vacuous 100% correct.
- [ ] #5 tryRepeatReview is split into eligibility, decide and commit steps with behaviour unchanged; applyClassifierReview has a single validation path and no unknown casts.
- [ ] #6 Evidence packet budget uses the real encoded request size and the routed model, with no Python emulation.
- [ ] #7 Focused tests extend the owning suites (repeat-review, evidence-packet, classifier-statistics, review-decision-authority-contract); bug repro for the rebased-diff gate is red on parent and green with the fix.
- [ ] #8 Jev is called on every re-review decision whenever the decision provider is available: no pre-call gate (path citation, excerpt, oversize, human-feedback context or review-context ineligibility) skips the call. Evidence that is thin or oversized is sent bounded with declared omissions and Jev answers insufficient_evidence; only provider unavailability, opt-out or off mode may skip.
- [ ] #9 Every skip, fallback or abstention still records a reason, and a test proves each former pre-call exit now reaches the classifier or records provider-unavailable/opted-out as the only skip reasons.
- [ ] #10 px stats reports the share of re-review decisions where Jev was called; with the provider available it is 100%, and any shortfall is attributed to a named reason.
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Operator requirement (2026-10-07): Jev should always be called on a review decision. If Jev cannot decide (insufficient_evidence, below-threshold abstention, call failure), the decision goes to the general reviewer. This widens scope beyond removing hasBroaderReviewObligations: the evidence builder fallbacks (missing-or-ambiguous-path, no-structural-excerpts, oversize, incomplete-evidence) and the review-context ineligibility exits in tryRepeatReview currently skip the call. They must instead degrade the packet and let Jev abstain via insufficient_evidence, with routing still decided by the existing thresholds and every non-deciding outcome handed to the general reviewer with a recorded reason.

Resolved: rounds with human feedback are also sent to Jev, with that feedback included in the evidence. Jev decides only when it clears the existing thresholds; otherwise the general reviewer decides.

Open point for the implementer to confirm with the operator rather than assume: whether first-round reviews, which have no prior findings to classify, are out of scope for Jev (assumed out of scope).
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
