---
id: TASK-2832
title: Count all reimplementation rounds and simplify Agent performance output
status: backlog
assignee: []
created_date: '2026-11-03 05:52'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 302016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the misleading Agent performance fix metric with the operator's requested all-cause reimplementation count and remove the diagnostic noise from the default report.

Operator reproduction: completed Missions for 2026-10-28 through 2026-11-03 show codex: 19 deliveries, average authored PR fix rounds 0.86, PR fix n 7; custom: 2 deliveries, average 0.00, PR fix n 1. Ownership coverage is 21/21, but review-fix coverage is 11/21. The operator expects substantially more returns when inspecting Forgejo. That expectation is a hypothesis to verify, not a target or multiplier. TASK-2829 was accidentally integrated before the operator considered it ready; this mission must be independently evidenced. The statistics implementation and prior requirements are in TASK-2818; its narrow coding-defect/cause filters do not define this new metric.

Required output: keep Agent family and # missions as implementer; replace Average authored PR fix rounds and PR fix n with a single integer column named # reimplementation rounds. This is the total count for that agent in the selected completed-mission population, not an average over a selectively observed subset. Remove Delivery ownership coverage, Review-fix mission coverage, the delivery/measurement explanatory paragraph, and the entire Repair/re-review cause / Obligations table from default weekly and range output. Apply the same metric to current and previous periods. Leave resource/spend reporting intact.

Counting contract: count each distinct round in which delivered work is sent back for reimplementation after the initial implementation, regardless of cause or sending stage: pre-review verification/contract gates, PR reviewer feedback, human requests, integration gates, infrastructure, pushback, or an unknown cause. Unknown cause must never exclude an established return. Distinct returns in separate cycles count separately even when the revision, gate or finding is unchanged. Multiple findings, duplicate events, provider/local copies, retries and repeated polling representing one return count once. A failed check with no return to implementation, an initial implementation, an approval, or a mechanical re-review without a return is not a reimplementation round. Trace actual workflow transitions and repair launches, including returns before a PR/review round exists; do not assume review-round-count-minus-one captures the contract.

Preserve truthful implementer attribution when A is replaced by B: attribute returns to the implementer responsible for the work sent back, not automatically to the repair executor or final delivery owner. Keep final ownership for delivery counts. Preserve unassignable provenance explicitly without inventing an agent. An established return with an unknown cause is a known count; absent historical evidence is a different problem and must not become zero or be silently omitted from a reassuring total. If the full count cannot be established, use an honest unavailable/incomplete value in the metric cell rather than reintroducing the removed diagnostic sections.

Inspect and reuse the existing owners before implementing: review-statistics.ts, the review-statistics-evidence adapter, statistics report selection/aggregation/rendering, recording and cohort consumers, and existing lifecycle/repair persistence. Reconcile all affected production consumers through one application-owned calculation and typed ports. Remove superseded authored-fix algorithms, cause-based exclusions, obsolete fields and redundant tests while preserving distinct behavioral assertions; do not wrap the old calculation in another metrics subsystem. A migration must not silently relabel old narrower stored values as all-cause counts.

Correct historical reporting as well as future writes. Reconcile all 21 completed Missions in the reported week against retained workflow history and paginated real Forgejo reviews/comments. Read provider history through existing boundaries. Produce a reviewable per-mission audit with counted return identities, source evidence, attribution, deduplication and explicitly unreconstructable gaps, and reconcile those totals to the displayed per-agent counts. Validate reconstruction idempotently on an isolated database copy first; preserve raw history and do not silently rewrite the operator database or mutate PRs. Evidence belongs in mission artifacts, not verbose product output. Do not assert a corrected average or promise 5-10 rounds before this audit.

Read ADR 0057 and extend the existing owning suites with focused parent-red/fixed-green reproductions. No gate additions/restorations, budget inflation or convenience integration suite. Unit headroom remains 500 ms; any added/modified integration test must complete within 3.5 seconds. Manually exercise the built production reporting path end to end against isolated state, including gate/PR/human returns, repeated cycles, agent replacement, historical reconstruction and weekly/range output. Update only necessary live metric documentation. This task creates the mission specification; implementation and integration are separate operator actions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Default current-week, previous-week and range Agent performance tables contain Agent family, # missions as implementer and # reimplementation rounds; the old average, PR fix n, both coverage lines, explanatory paragraph and cause/obligation table are absent. Spend reporting remains intact.
- [ ] #2 One production counting authority includes distinct returns from every workflow stage and cause, including pre-review gates, PR/human requests, integration, infrastructure, pushback and unknown cause. Duplicate representations count once; distinct repeated cycles count separately; no-return retries, initial implementation and approval-only re-reviews count zero.
- [ ] #3 Agent replacement retains attribution to the author responsible for rejected work without transferring earlier returns to the final owner. Known counts survive unknown causes; missing history or provenance is never guessed, silently omitted, or converted to zero.
- [ ] #4 A read-only audit reconciles all 21 Missions completed from 2026-10-28 through 2026-11-03 with retained workflow history and paginated Forgejo evidence. Each per-mission count, attribution and deduplication decision has evidence; gaps are explicit and report totals reconcile without any assumed multiplier.
- [ ] #5 Historical reconstruction and future recording/reporting use the same corrected authority. Isolated-copy reconstruction is idempotent, preserves raw evidence, and does not treat old authored-fix values as the new metric; no silent live database writes or PR mutations occur.
- [ ] #6 All affected production callers and public metric consumers use the corrected contract; superseded authored-fix calculations, filters, fields and redundant tests are removed while distinct assertions survive. No parallel legacy calculation or render-only relabeling remains.
- [ ] #7 Focused red/green regressions cover all-cause returns, pre-review returns, deduplication versus distinct repeated cycles, missing evidence, replacement attribution and clean output. Manual built-production E2E on isolated state verifies counting, reconstruction and weekly/range output within repository test limits; necessary live documentation describes the final contract.
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
