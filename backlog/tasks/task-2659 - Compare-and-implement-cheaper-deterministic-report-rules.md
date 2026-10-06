---
id: TASK-2659
title: Compare and implement cheaper deterministic report rules
status: backlog
assignee: []
created_date: '2026-10-06 10:01'
labels:
  - ai_sdlc
dependencies: []
references:
  - docs/adr/0065-local-review-classification-evidence.md
priority: medium
ordinal: 165008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Compare and implement cheaper deterministic report rules for ADR 0065 option A: earlier feedback on submitted verification reports before general review.

The current reference checker establishes that a referenced artifact exists, not whether its contents report success. In TASK-2650, the real production checker accepted references for four historical reports. Jev agreed with the successful-report control, rejected explicit deferral and an exit-one failure, and abstained on a command with no outcome. These literal cases may be handled more cheaply by deterministic rules. Production reference checks took 0.013–0.381 ms per row; Jev requests took 229–264 ms. Those timings do not measure the complete feedback loop.

Compare mechanical rules with the existing reference checker, Jev and independently labeled report outcomes on development cases, then freeze the rules for new historical validation. Cover explicit nonzero exits, failed checks, deferred or unrun checks, missing outcomes, mixed results, quotations/negation and contradictory summaries. Keep report-content interpretation distinct from proof that a command ran, succeeded on the reviewed revision or established a requirement. Ambiguous reports require investigation; an absent failure word is not proof of success.

Implement only rules supported by the comparison, with concrete feedback about the reported failure, deferral or missing result. Workflow remains Active → code checks → general LLM review; a Jev content check is optional only where it demonstrates value beyond the deterministic rules. Keep reference validation, executable verification and general review scope unchanged. No classifier or pattern match fabricates execution proof.

Measure false favorable answers, false warnings, abstentions/escalations, coverage and complete preparation/check/fallback time. Use Parallix application/domain contracts, existing persistence and telemetry conventions, and on-demand projections; do not create committed report inventories or a parallel telemetry authority.

Decision: docs/adr/0065-local-review-classification-evidence.md, option A. The four historical replay records and exact packets are archived under ../parallix-artice-data/task-2650/research-records/code-evidence-comparison.{md,json}.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Comparison includes the four historical production-replay cases and a fresh validation set with frozen mechanical rules; raw disagreements and ambiguous cases remain visible. Reference validity, report meaning and verified execution are scored separately.
- [ ] #2 Explicit failure, deferral/unrun work and missing outcomes produce precise early feedback. Mixed, quoted, negated or contradictory reports do not become favorable merely because a simplistic pattern misses the failure.
- [ ] #3 Only rules with demonstrated value are integrated into early verification feedback. Existing reference checks, executable gates and general review responsibilities remain unchanged; no rule claims to prove execution from report text alone.
- [ ] #4 Parallix-compliant telemetry records rule/version, reason, result, fallback and measured time through existing application-owned contracts, with on-demand comparison of error rates, coverage and end-to-end cost against Jev.
- [ ] #5 Focused checks in the owning suites prove the report-status contract and fail-safe handling of ambiguous inputs; documentation explains the new feedback and its limits without duplicating implementation inventories.
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
