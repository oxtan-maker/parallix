---
id: TASK-2832
title: >-
  Replace authored PR fix rounds with average reimplementation rounds per
  mission
status: done
assignee: [claude]
created_date: '2026-11-03 05:52'
updated_date: '2026-11-03 05:55'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 302016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
BEFORE: the Agent performance table shows "Average authored PR fix rounds" and "PR fix n". The numbers are wrong: it only counts coding-defect PR fixes on a selectively observed subset (codex 0.86 with n 7 of 19 deliveries, custom 0.00 with n 1, review-fix coverage 11/21). It misses most returns to implementation.

AFTER: the same table shows one column, "Avg reimplementation rounds / mission": the number of times an agent's delivered work was sent back for reimplementation, divided by that agent's # missions as implementer, over all completed missions in the period. Same column in current week, previous week and range output. Nothing else is added.

This is a replacement of the existing table column, not a new statistics feature. Do not add a metrics subsystem, parallel calculation, wrapper or new report section. Reuse the existing owners (review-statistics.ts, the review-statistics-evidence adapter, stats report selection/rendering) and delete the superseded authored-fix calculation, the coding-defect/cause filter, PR fix n, Delivery ownership coverage, Review-fix mission coverage, the delivery/measurement explanatory paragraph, the Repair/re-review cause / Obligations table, and their tests and docs. If TASK-2829 or TASK-2818 introduced these, revert those hunks rather than rewrite.

What counts as a reimplementation round (one per distinct return, regardless of cause or stage): verification/contract gate failures that send the work back, PR REQUEST_CHANGES from agent reviewers, human requests, integration gate failures, workflow/infrastructure bugs that force a redo, pushback rounds, and revoked approvals (an approval later revoked, e.g. a hallucinated approval from an agent reviewer, sends work back). Unknown cause still counts. Distinct returns in separate cycles count separately even with an identical finding or gate. Multiple findings, duplicate events, provider/local copies, retries and polling for one return count once. An initial implementation, an approval, a failed check with no return to implementation, and a mechanical re-review without a return count zero. Returns before a PR exists must be counted; review-round-count-minus-one is not the definition.

Attribution: a return belongs to the agent that authored the rejected work, not to the repair executor or final delivery owner. Author must be derived from retained history (lane events, review rounds, repair launches, Forgejo). A return whose author is hard to find is a problem to solve by tracing the history, not a reason to print an incomplete marker, drop it, or turn it into zero. Never invent an agent. Only after every retained source has been exhausted may a single return remain unattributed, and then it is still counted in the total and listed in the audit, so one missing fact can never corrupt or shrink the rest of the aggregate.

Correct numbers are the acceptance bar. The operator expects the average to be in the range of roughly 3-10 returns per mission because of gate failures, workflow bugs, agent and human PR returns and revoked approvals. That is a hypothesis to verify, not a target or multiplier: do not tune the counting to land in that range. Reconcile the 21 completed Missions of 2026-10-28 through 2026-11-03 by going through Forgejo (paginated reviews and comments, GET only, read through the existing Forgejo auth/boundaries) together with retained workflow history (gate rebounds, revoked approvals, repair launches). Produce a per-mission audit (counts, sources, dedup decisions, attribution, explicit gaps) and show that the displayed per-agent averages equal audit totals divided by missions. If the audit shows the average is far below what Forgejo and workflow history imply, the counting is wrong and must be fixed before completion.

Historical reporting must use the same counting authority as future recording. Validate on an isolated copy of the database first; do not write to the operator database or mutate PRs. Do not relabel old authored-fix values as the new metric.

Robustness: a missing or invalid value in one record (for example a missing Codex quota snapshot) must never destroy or distort an aggregate. Missing data is excluded from that one figure only and the remaining measured data still aggregates correctly (a missing quota stays a dash, a measured 0% stays 0%). The same holds for the reimplementation average: one mission or return with missing evidence must not turn the whole agent row incomplete or wrong. Spend/resource units are protected by the contract below.

NON-NEGOTIABLE UNIT CONTRACT: the model-attribution repair must preserve the existing resource units, formatting meanings and aggregation rules. Claude/Anthropic and Mistral/Vibe spend remains dollars, summed per stage and total, with parentheses showing each stage's share of that model's dollar total. Custom/local runtime remains minutes, summed per stage and total, with parentheses showing each stage's share of that model's runtime total. Codex/OpenAI quota remains the recorded percentage quota peak per stage and the maximum peak in total / peak, never summed quota, consumption, delta, dollars, minutes, or a stage-share percentage. Missing quota remains unavailable (—), never a fabricated 0%; an evidenced real 0% remains valid. Do not convert or unify units, change peak to consumption, alter percentage denominators, or replace the existing resource table with a new metric. Actor/provider evidence selects the resource contract; changing the displayed identity to a model must not change that selection. The explicitly requested replacement of authored PR fix averages with integer reimplementation counts is the only metric-unit change authorized by this mission.

Read ADR 0057. Add parent-red/fixed-green reproductions to the owning existing suites; no gate additions, budget inflation or convenience integration suite; unit tests stay under 500 ms, integration under 3.5 s. Manually exercise the built production reporting path on isolated state (gate, PR, human and revoked-approval returns, repeated cycles, agent replacement, weekly and range output). Update only the live metric documentation that describes this column.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The performance table (current week, previous week, range) shows Model, # missions as implementer and Avg reimplementation rounds / mission, replacing Average authored PR fix rounds and PR fix n.
- [ ] #2 One production counting authority counts distinct returns from every stage and cause (pre-review gates, PR reviewer and human requests, integration, infrastructure, pushback, revoked approvals, unknown cause); duplicates count once, repeated cycles count separately, initial implementation and approvals count zero.
- [ ] #3 Returns stay with the author of the rejected work after agent replacement; author is reconstructed from retained history, never guessed, and a gap in one record never discards or zeroes the rest of the aggregate.
- [ ] #4 Removed with their tests and docs: authored-fix calculation, cause/coding-defect filter, PR fix n, both coverage lines, explanatory paragraph, Repair/re-review cause / Obligations table. No new statistics subsystem, parallel calculation or wrapper exists.
- [ ] #5 Audit of the 21 Missions completed 2026-10-28 through 2026-11-03 against paginated Forgejo reviews/comments and workflow history lists counts, sources, dedup, attribution and explicit gaps; displayed per-agent averages equal audit totals divided by missions; no multiplier assumed.
- [ ] #6 Historical reporting and future recording use the same authority; validated idempotently on an isolated DB copy; no live DB write or PR mutation.
- [ ] #7 One missing or invalid record (e.g. missing quota) never breaks or distorts an aggregate: only that figure is affected and the remaining data still aggregates correctly, covered by a focused regression. The exact resource-unit contract (dollars, minutes, quota peak with max, dash for missing, 0% for measured zero) holds in every report and is verified by retained assertions.
- [ ] #8 Parent-red/fixed-green regressions in the owning suites; manual built-production run on isolated state covers weekly and range output; necessary live docs updated.
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
