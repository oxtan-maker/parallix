---
id: TASK-2818
title: Make PR fix statistics accurate through one authoritative calculation
status: backlog
assignee: []
created_date: '2026-10-24 05:59'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 296008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The completed-mission Agent Performance report for 2026-10-18 through 2026-10-24 is materially inaccurate. A read-only audit compared all 54 completed Missions with their actual Forgejo PRs, paginated formal reviews and issue comments, persisted Review rounds/events and usage statistics. The production reviewStatistics function reproduced all 54 stored values, proving the current calculation itself is defective.

Observed totals (missions / stored fix rounds / Forgejo REQUEST_CHANGES reviews / integration-gate approval revocations): codex 46 / 33 / 42 / 83; claude 5 / 6 / 12 / 8; custom 3 / 1 / 4 / 1. There are 175 rounds after the initial rounds versus 40 reported fixes (4.38x review churn). These are separate observations, not a corrected count: requests, revocations, repairs, pushbacks and mechanical re-reviews must be reconciled by identity and meaning before aggregation. Do not target an assumed 5x multiplier or simply use round count minus one.

Concrete evidence:
- http://localhost:3300/magnus/parallix/pulls/735 (TASK-2776): stored zero despite two human REQUEST_CHANGES reviews and one integration-gate revocation.
- http://localhost:3300/magnus/parallix/pulls/743 (TASK-2784): stored zero despite seven integration-gate revocations.
- http://localhost:3300/magnus/parallix/pulls/744 (TASK-2785): stored one despite nine integration-gate revocations and one changes-requested round. Some attempts involved infrastructure problems; do not silently equate every failed gate with an implementer code defect.
- http://localhost:3300/magnus/parallix/pulls/729 (TASK-2775): five local request-changes events represent three rejected rounds; rounds 2 and 4 each have a reviewer event plus a duplicate unknown-actor event. The first rejected round belongs to custom; later rounds belong to codex.
- http://localhost:3300/magnus/parallix/pulls/779 (TASK-2807): stored zero despite two human REQUEST_CHANGES reviews and one integration-gate revocation.

Current calculation owner: src/application/services/review-statistics.ts, used by StatsRecordingUseCase.recordIntegration. It counts raw reviewer_outcome/request-changes events, ignores human-note/operator correction and approved-decision revocations, selects positive eventCount instead of reconciling decision history, and applies final-implementer filtering only to its decision fallback. Thus one event hides three recorded decisions, duplicated events inflate counts, and another implementer's mistakes can be reassigned to the final agent. Also inspect the existing renderer stored-value selection, cohort projection, historical backfill and recording callers for divergent semantics and fabricated zeroes. Reuse existing application/domain owners and typed ports; do not create another metrics subsystem.

Operator requirement: deliver ONE production calculation path that works and remove the superseded paths. This mission is consolidation, correction and deletion, not permission to layer a new algorithm over the old ones. Trace all affected writers, readers, report consumers and historical repair paths before editing. Migrate them to the shared authority; remove obsolete calculations, alternate fallbacks, compatibility wrappers, render-time overrides, dead exports/seams and redundant tests while preserving distinct assertions. No parallel implementation, feature-flagged legacy route, renamed duplicate, catch-and-guess fallback, or follow-up task for a known in-scope defect is acceptable. Do not add a new architecture gate or weaken operator-owned gates.

The ONLY permitted exception to equal mission-wide and per-agent counts is truthful implementer attribution (finding 5 in the audit). If agent A cannot make progress and the operator replaces A with B, B must not inherit A's earlier mistakes. Attribute each repair obligation to the implementer responsible for the rejected work at that time, independently of the agent who later fixes it or owns the final approval. Preserve A's history and the mission total; do not drop earlier failures, charge them to B, or use final ownership as a blanket exclusion. A later judgment of work authored before replacement must retain that provenance where evidence establishes it. Insufficient provenance remains explicitly unknown, never guessed or converted to zero. Make the report's mission populations, per-agent denominator and observation coverage consistent with this rule so averages remain interpretable. This exception excuses none of findings 1-4 or unfinished consolidation.

Define and enforce the counting contract from actual review/repair behavior: human corrections and genuine integration repair returns cannot disappear; duplicate recordings and provider/local representations of one obligation count once; mechanical approvals, unchanged-tree re-reviews, repeated infrastructure failures and pushbacks must not become invented coding mistakes. Preserve truthful delivery churn and distinguish its cause where evidence supports it rather than hiding it or inventing blame. Reconcile actual Forgejo evidence through existing adapters/application ports; do not fetch provider state inside synchronous renderers or unit tests. Unknown measurements and incomplete attribution must stay visible.

Repair existing historical reporting as well as future writes through the same corrected owner. Provide a reviewable, idempotent reconstruction using retained authoritative evidence, with before/after counts and coverage. Do not silently rewrite live data, mutate real PRs or run agent workflows merely to generate evidence. Validate reconstruction on an isolated copy first and keep raw history intact. Missing historical facts must be disclosed; neither hardcoded PR exceptions nor the temporary audit files are a production data source.

Read ADR 0057 and extend the existing owning statistics/review/report suites. Retain focused parent-red/fixed-green reproductions for the demonstrated failures, including replacement attribution, mixed event/decision history and duplicate recordings. Unit tests stay within 500 ms headroom; any changed integration suite stays within 3.5 seconds. No full-gate ritual, new integration/E2E suite for convenience, budget inflation or gate changes. Manually validate the built production reporting path end to end against isolated state and reconcile representative real Forgejo histories read-only. Update concise live metric documentation for the final user-visible contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One application-owned calculation supplies all affected statistics writers/readers and historical reconstruction. Trace production callers, migrate them, and delete superseded algorithms, fallbacks, overrides, exports, seams and redundant tests; preserving both behind a wrapper fails acceptance.
- [ ] #2 Retain parent-red/fixed-green reproductions for ignored human corrections, ignored integration repair returns, duplicate reviewer events, partial event history hiding decisions, and agent replacement. Each logical obligation is reconciled once from its evidence, without fabricated zeroes or guessed blame.
- [ ] #3 Agent A’s rejected work remains attributed to A after replacement by B, including when B performs the repair; B receives only obligations attributable to B’s own work. Preserve mission-wide history, explicit unknown provenance and coherent per-agent populations, denominators and observation coverage. This is the sole allowed attribution exception, not permission to omit other defects.
- [ ] #4 The metric contract distinguishes actual repair obligations and delivery churn from duplicate publications, mechanical re-review, pushback and infrastructure failure. Human corrections and genuine gate repairs cannot silently disappear; incomplete coverage is explicit. All public consumers agree for the same population and attribution scope.
- [ ] #5 Reconcile all 54 audited completed Missions against real Forgejo PR evidence and retained local history through the corrected path. Explain each difference from the old report with evidence; do not assert that 175 subsequent rounds or an assumed multiplier is the corrected fix count. Representative checks include PRs 729, 735, 743, 744 and 779.
- [ ] #6 Existing historical statistics and future writes use the same corrected authority. Demonstrate idempotent reconstruction and before/after coverage on an isolated database copy, preserve raw evidence, disclose unreconstructable history and avoid silent live-data writes or provider mutations.
- [ ] #7 Manual end-to-end validation exercises the built production recording/reporting path with isolated state, including an implementer replacement and historical reconstruction. Extend owning suites, preserve distinct assertions and repository verification limits, and update only necessary live metric documentation.
- [ ] #8 Final evidence identifies removed competing paths and migrated callers and proves production caller convergence. Completion is refused while a known in-scope calculation, attribution, historical-reporting or consolidation defect remains; do not defer it, retain dormant legacy behavior, or substitute mocks/import checks for production behavior.
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
