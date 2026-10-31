---
id: TASK-2824
title: Resume pending integration repair assessment before review approval
status: backlog
assignee: []
created_date: '2026-10-31 14:45'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 298008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After a successful exact-check repair, px review can resume an approved round on an active Mission that still has a pending integration-repair assessment. ReviewState.save persists the approved state and attempts approve, but requireRetainedJudgment correctly rejects the transition: "Integration repair may only retain the original judgment with proven evidence". The workflow exits at handoff:record instead of assessing the candidate and choosing retention or fresh review.

Observed on px-0021 / mission/px-0021 / Forgejo PR #790 on 2026-10-31 at commit 7ba62651b. The duplicate fixture import was repaired; ./scripts/verify-local.sh static-analysis reran successfully, CP-5 reported ready, then round 2 approval persistence failed with Mission status active. Evidence: run:workflow-21d4340f-2a32-4a8c-b143-c147a57b3002:stdout@271931+16384. A read-only public CLI integrate px-0021 --dry-run also rejects the active state. Do not assume another review/integrate retry repairs this state.

Trace: review-loop/review-loop.ts resumes retained check recovery, then startState persists the earlier approved round; adapters/review/review-state.ts calls approve without a retention assessment. application/integrate/approval-retention.ts already owns revision-pinned assessment, equivalence, validation, human-feedback reconciliation, and retain-versus-withdraw decisions; review ports currently do not expose that capability. Reuse that owner through typed application ports and composition rather than relaxing domain guards, fabricating evidence, unconditionally revoking approval, or creating another approval mechanism. Trace interruption and normal entry as well as post-repair entry; avoid stale flattened state writes after assessment advances the aggregate.

No matching open task found in main backlog. TASK-2820 is completed antecedent work. TASK-2806 concerns a coordinator remaining alive after children exit, whereas this incident exits with an explicit domain rejection. Preserve agent ownership, provider protections, PR and checkpoint identity, operator-owned gates and CPU budgets, and the human final integration decision. Do not mutate live mission/provider data for reproduction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused parent-red/fixed-green reproduction in the existing owning review-start/repair suite: an active Mission with retained original approval and pending integration assessment survives successful exact-check repair and reaches the correct next action without blindly re-persisting approved state.
- [ ] #2 Review entry and continuation reuse the existing revision-pinned retention owner. Equivalent patches retain the original judgment only with all required fresh committed-tree validation and provider evidence; changed patches withdraw that judgment and enter the existing independent review path on the repaired revision.
- [ ] #3 Missing, stale, failed or unavailable evidence, uncommitted changes, concurrent Mission/HEAD changes and human change requests remain blocked with actionable diagnostics; no synthetic approval, weakened domain guard, duplicate review round or overwritten human decision.
- [ ] #4 Interruption/restart and repeated invocation preserve authoritative assessment, round, implementer and checkpoint state. Reload aggregate-derived review state after a transition so old approved flattened state cannot overwrite or bypass the new review route.
- [ ] #5 Run focused owning suites with unit headroom and manually exercise the built public CLI in disposable repositories with isolated workflow state and controlled adapters. Cover equivalent, changed and blocked repair outcomes without landing or touching live missions; preserve existing assertions, verification tiers, gates and CPU budgets, with any touched integration suite at or below 3.5 seconds.
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
