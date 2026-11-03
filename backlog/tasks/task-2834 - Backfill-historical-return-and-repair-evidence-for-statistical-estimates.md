---
id: TASK-2834
title: Backfill historical return and repair evidence for statistical estimates
status: backlog
assignee: []
created_date: '2026-11-03 10:56'
updated_date: '2026-11-03 12:11'
labels:
  - ai_sdlc
dependencies:
  - TASK-2832
  - TASK-2835
priority: medium
ordinal: 304016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Recover historical sendback, reimplementation and repair evidence from before verification measurement support was merged, so the operator can make useful statistical estimates. Collect all accessible structured history across the available period rather than an arbitrary small sample. Full reconstruction of unrecorded CPU or execution boundaries is not required and must never be fabricated. This mission specifies future implementation; creating it does not apply a backfill or authorize live database/PR mutation.

Dependency and regression protection: land on the final TASK-2832 counting/model/resource contracts and TASK-2835 durable end-to-end flow collection, causal identity, actor-timing and projection contracts and inspect every relevant statistics fix since TASK-2818 and the verification-measurement mission, including fixes integrated while this task waits. Trace history, production callers and owning assertions before editing. The inspected main currently contains TASK-2818 at a6852abd2 and verification measurements at a3976d2df; do not freeze those versions as the desired implementation or restore their superseded semantics. TASK-2832 owns all-cause return counting, model attribution and report layout. TASK-2835 owns the completed future flow observation and shared projection contracts; recover historical evidence into those final owners rather than introducing a legacy parallel schema or undoing its strict fresh-collection completeness. Historical evidence must retain original collection era and provenance so reconstructed facts or estimates never masquerade as complete new measurements. Extend its corrected authority; do not create another calculation, reinterpret old authored coding-fix scalars as all-cause returns, or resurrect cause filters that discard established returns. Unknown cause does not erase a known return; missing evidence does not imply zero. Preserve attribution to the author/model responsible for returned work across implementer replacement.

The current stats backfill command no longer reads CSV. LegacyStatsBackfillAdapter reads retained Mission/Review history, existing database measurements and Git patch evidence; its write path updates derived scalar counts. Normal reports already reconcile retained history, so rewriting those scalars alone does not recover missing evidence. Reuse the command/service/ports where their current contracts fit a durable evidence-recovery workflow. Establish which writes still serve production consumers; remove superseded migration-only paths, misleading legacy naming and redundant calculations/tests while preserving distinct assertions. No new CSV migration or historical review-state.json/Markdown compatibility importer is requested; do not resurrect the importer removed by TASK-2821. Recovered evidence must reach normal production reads through existing typed application ports and adapter boundaries, without provider network access in synchronous rendering.

Read-only investigation on 2026-11-03 found, before the measurement merge at 06:23:43Z, 768 review-to-active transitions across 322 Parallix missions, 1,984 retained review rounds across 800 missions, 323 changes-requested decisions, 376 integration-gate revocations and 659 rebound.repair records across 146 missions containing durationMs, agent/model and outcome. These are candidate evidence inventories, not corrected return totals or guaranteed complete populations. Older validation events retain revision and hook names but no per-gate execution intervals. Pre-merge current-work events lack sourceId boundaries. Verification-attempt observations first appear at 06:43:41Z that day. Recount and verify on the implementation snapshot; heterogeneous timestamp offsets must be parsed as instants.

Sources: enumerate repository-scoped Mission/Review rounds/events and lifecycle history, rebound repair/outcome and validation records, retained workflow/run telemetry, Git revisions/patches and paginated real Forgejo PR reviews, issue comments and review comments as needed. Recover all usable structured records with stable source identities, timestamps, repository/mission/revision links, provenance and explicit coverage. Preserve original raw evidence and record conflicts rather than silently overwriting it. Examine retained logs/artifacts only where needed to fill a demonstrated gap; disclose unavailable sources. Keep arbitrary archived backups and narrative logs from becoming alternative production authorities.

Representative reconciliation: Forgejo PR 735 has two human requests and an integration-repair comment; PR 743 has seven formal approvals and no formal change requests while local history retains seven gate revocations. Also inspect PRs 729, 744 and 779 for duplicate publications, repeated repairs and replacement attribution. Paginate all source collections, including closed/merged PR discovery; do not count review publications or round count minus one as returns. Reconcile local/provider representations by evidence identity and retain distinct actual return cycles. Stable IDs and resumed runs must make repeated collection/application idempotent, including updates, partial failures and duplicate pages.

For statistical usefulness, provide an analysis export/report with populations, date ranges, observation counts and denominators per metric and relevant period/model/stage/cause where evidence supports them. Distinguish direct observations, reconstructed facts, estimates and unavailable values. Explain missingness/selection bias and show whether compared cohorts have comparable coverage. Include distributions of supported repair durations and returns; use a transparent estimation method with assumptions and uncertainty or sensitivity bounds where justified, without promising representativeness or inventing a correction multiplier. Rebound durationMs describes a recorded repair attempt, not complete mission repair time. PR-to-review timestamps are elapsed turnaround, not agent execution or CPU. Do not sum overlapping intervals, mix these boundaries with new measured intervals, or import unproven old attempts into the new verification-attempt/DAG/CPU metrics. A useful evidence-backed subset with explicit gaps meets the estimation goal where facts cannot be recovered.

Deliver dry-run by default with per-mission/source additions, deduplication/conflicts, before/after metric and coverage changes, and unresolved gaps. Explicit apply must preserve existing evidence and support repeatable recovery. Validate collection and application on an isolated consistent database copy first; retain a reviewable audit and production report comparison. Do not apply to live operator state in this mission without explicit subsequent authorization. Do not mutate Forgejo PRs, replay agent workflows or rerun old gates to manufacture historical evidence.

Protect all later stats fixes: unchanged evidence must retain current report results; recovered evidence may change only values justified by the audit. Preserve lifecycle completion/week/repository scoping, integer all-cause returns, model identities and implementer/reviewer attribution. Conserve recorded dollar and minute totals across attributed and unattributed data; Codex quota remains per-stage peak and overall maximum, missing stays unavailable and observed zero stays zero. Repeated apply must not duplicate usage, merge distinct models, clear valid telemetry or revert resource/display semantics. Keep the concise report contract from TASK-2832; audit detail belongs in recovery artifacts/analysis exports.

Read ADR 0057 and extend existing owning recovery/statistics/review suites. No new gates, restored gates, budget inflation or convenience integration suite. Unit tests meet 500 ms headroom; every added/modified integration case and suite stays within 3.5 seconds. Manually exercise the built production collect-preview-apply-report path end to end on isolated state, including a second unchanged apply and source failure/resume. Update concise live documentation only for final user-visible recovery and interpretation behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Inspect final TASK-2832 and all subsequent relevant stats fixes and production callers before implementation; reuse the corrected authority and remove superseded recovery paths without restoring old counting, CSV/import, model, unit or report behavior.
- [ ] #2 Collect all accessible historical structured evidence over the available repository-scoped period through existing boundaries, including fully paginated Forgejo history. Stable identities/provenance reconcile duplicates and conflicts while distinct returns survive; raw history and live workflow state remain intact.
- [ ] #3 Production reads consume recovered evidence through the final shared counting owner. Known all-cause returns, missing evidence and unknown causes remain distinct; attribution across author/model replacement is evidence-based and never assigned wholesale to the final owner.
- [ ] #4 Analysis output supports statistical estimation with explicit populations, denominators, coverage by relevant cohorts/time periods, supported distributions, provenance, assumptions and justified uncertainty/sensitivity. Unrecorded CPU, source intervals, DAGs and gate attempts are never fabricated or mixed with measured verification telemetry.
- [ ] #5 Default dry-run provides per-mission/source before/after counts and coverage, additions, conflicts and gaps. Isolated-copy apply is idempotent and resumable across partial failures/duplicate pages; no live database writes or PR mutations occur without subsequent operator authorization.
- [ ] #6 Audits reconcile PRs 729, 735, 743, 744 and 779 plus the full collected population; source inventory counts are revalidated and are never presented as corrected return totals. Report changes are explained by retained source evidence, not assumed multipliers.
- [ ] #7 Regression checks preserve current results for unchanged evidence, lifecycle completion/windows/repository scoping, all-cause count semantics, concrete model and reviewer attribution, dollar/minute conservation, quota peak/max rules and missing-versus-zero. Reapply neither duplicates usage nor clears telemetry or merges distinct models.
- [ ] #8 Focused owning-suite checks and manual built-production E2E on isolated state exercise collection, preview, apply, reports, second apply and interrupted-source resume within repository budgets. Concise live docs explain recovered versus estimated data and remaining limitations.
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
