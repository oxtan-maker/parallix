---
id: TASK-2846
title: 'Consolidate duplicated launch-result, review-round and per-run usage types'
status: backlog
assignee: []
created_date: '2026-11-10 07:11'
labels:
  - ai_sdlc
  - refactor
dependencies: []
priority: medium
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pre-existing duplication found during adversarial review of px-0036.02 (verified on main). Consolidate into single owners; no behaviour change.

1. StatusReviewRound (src/application/ports/cli-workflows.ts) mirrors ReviewRoundSummary (src/application/projections/mission-board.ts) field for field. Keep one projection type.
2. ReviewAgentLaunchResult (src/application/ports/review-round.ts) and the ReboundStartAgent return type (src/application/ports/repair-agent-launch.ts) each declare their own inline launch-result shape, overlapping AgentProcessResult. Give them one application-layer launch-result port.
3. Per-run provider, model and usage facts live both in RunRecord.resources.provider (read by verification-statistics agentResources.runs) and in usage_statistics rows. Choose one owner and join the other to it by run id.
4. UsageRepository.findWhere (src/adapters/sqlite/usage-repository.ts) is findAll() plus a JS filter. Push the predicate into SQL.
5. consumer-domain-requirements.ts and persistence-domain-map.ts carry line numbers next to their anchor symbols. Keep the anchor and drop the line numbers.

Constraints: reuse existing owners, remove superseded declarations and redundant tests, extend owning suites, no new verification gates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 StatusReviewRound and ReviewRoundSummary are one type with every consumer migrated
- [ ] #2 One application-layer launch-result type replaces ReviewAgentLaunchResult and the ReboundStartAgent inline shape
- [ ] #3 Per-run provider/model/usage has one named owner; the other store joins by run id with no duplicated fields
- [ ] #4 UsageRepository.findWhere filters in SQL; its callers still pass
- [ ] #5 No line numbers remain in consumer-domain-requirements or persistence-domain-map; guards key on anchors only
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
