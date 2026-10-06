---
id: TASK-2671
title: Fix Jev repeat-review revision pinning and show truthful weekly PR statistics
status: backlog
assignee: []
created_date: '2026-10-06 16:52'
labels:
  - bug
dependencies: []
priority: high
ordinal: 186008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix the production Jev repeat-review route and replace the verbose PR-decision statistics blocks with one truthful, readable PR table.

Observed on 2026-10-06: the operator database contained zero classifier measurements despite repeat review rounds after Jev routing was merged. The round opens before pre-review rebase, verification and Backlog mirroring. The mirror can advance HEAD after the candidate revision was recorded; tryRepeatReview then rejects the mismatch before provider availability or telemetry initialization. TASK-2662 round 3 recorded b2875b42331f5dc7772e4470120397d65f15f2f4, while the normal status transition advanced HEAD to 75bd0679d2a8b8f9fd330f65f4a9e7e15a76d9c4. That diff only changes the mission task status from active to review. An isolated reproduction returned null with zero availability checks and zero telemetry initialization.

Correct candidate pinning through the existing review/lifecycle authorities after pre-review work. Preserve fail-closed behavior for real revision drift, broader obligations and incomplete finding sets; do not remove the HEAD safety check or infer approval from bookkeeping. Record meaningful eligibility/skip/fallback facts so failed routing is diagnosable.

Presentation requested by the operator: one table titled PR, with exactly two rows, This week and Last week, and explicit UTC date ranges. Replace both repeated multi-line PR decision blocks. Proposed core columns: Period, PR decisions, Jev decisions, Jev share, Eligible repeat decisions, Jev calls, Reviewer fallbacks, Observed false clears, Observed false returns, Unobserved Jev decisions, Coverage. Use concise unambiguous labels and retain the denominators needed to interpret correctness; refine column selection to avoid redundant or misleading metrics. Coverage must explicitly describe its measured population. Missing historical eligibility/attempt/outcome evidence is unavailable or partial, not zero or complete. Do not infer that all historical decisions were checked for Jev. Zero calls should remain a truthful measured zero where ascertainable. Distinguish applied verdicts from API calls, distinct eligible decisions from attempts, fallback from abstention, and observed correctness from unobserved outcomes. Provide concise diagnostic detail for skip/fallback reasons without recreating the two verbose report blocks; timings and shadow data must not invent evidence.

Scope covers the revision mismatch and reporting only. Operator will restart web in a fresh terminal; credential provisioning, credential propagation and process restarts are outside this ticket. Reviews launched from terminals with credentials use those processes' environment; the running web process's missing key affects only work launched by that process.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Normal pre-review bookkeeping and rebase/verification do not silently disable an otherwise eligible repeat review; classification uses the final verified revision through existing authorities and retains drift and broader-scope safeguards.
- [ ] #2 A focused reproduction is red on parent behavior and green with the fix in the owning review orchestration suite, including the real ordering of round opening, pre-review work, task mirroring and classifier routing; no live model or Forgejo calls.
- [ ] #3 Eligibility, skip and fallback accounting truthfully exposes why repeat review did not reach Jev; unavailable historical evidence is not fabricated as zero eligibility or complete classifier coverage.
- [ ] #4 px stats renders one clear PR table with This week and Last week as its two rows and explicit UTC date ranges, replacing both verbose PR decision blocks; columns distinguish decisions, calls, eligibility, fallback and observed correctness with necessary denominators.
- [ ] #5 Reporting tests cover no attempts, missing historical telemetry, partial coverage, unavailable outcomes, measured zeroes and nonzero classifier activity; no unavailable correctness or latency measurement is presented as success or zero.
- [ ] #6 Update live documentation only where behavior or interpretation changes; run focused owning checks, required static-analysis, and docs verification if live docs change. Preserve application ports, adapter boundaries and existing lifecycle authority.
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
