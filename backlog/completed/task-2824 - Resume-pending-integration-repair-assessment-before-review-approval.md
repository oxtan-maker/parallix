---
id: TASK-2824
title: Review repaired revision instead of resuming stale approval
status: done
assignee: [codex]
created_date: '2026-10-31 14:45'
updated_date: '2026-10-31 14:46'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 298008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
px review resumes an old approved round after a successful repair instead of reviewing the current repository changes. It tries to persist that approval and move an active Mission into integration; the domain rejects it with "Integration repair may only retain the original judgment with proven evidence".

Observed on px-0021 / PR #790 on 2026-10-31 at commit 7ba62651b: ./scripts/verify-local.sh static-analysis reran successfully and CP-5 reported ready, then approval persistence failed in round 2. Evidence: run:workflow-21d4340f-2a32-4a8c-b143-c147a57b3002:stdout@271931+16384.

Make review continuation review the repaired repository with the appropriate instructions through the existing review workflow. A reviewer needs repository access and task instructions; do not require the reviewer to consume integration bookkeeping. Inspect existing review restart, approval invalidation and round creation owners before choosing the smallest fix. Do not assume that exposing integration-retention assessment to review is necessary.

Preserve independent review, recorded implementer, human decisions, checkpoints, provider protections and operator-owned gates. Keep valid equivalent-patch retention working through its existing owner. No matching open task was found; completed TASK-2820 is related, while TASK-2806 covers an idle coordinator rather than this explicit rejection.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused parent-red/fixed-green reproduction in the owning review suite for successful repair followed by continuation incorrectly reusing the old approved round.
- [ ] #2 Continuation reviews the repaired revision through the existing reviewer workflow with repository access and authoritative instructions, and persists the new decision against the correct revision without reusing stale approval.
- [ ] #3 Preserve valid approval retention, human corrections, implementer identity, checkpoint evidence and human integration authority; retries or interruptions cannot fabricate approval or overwrite a newer decision.
- [ ] #4 Run focused owning checks with unit headroom and an isolated manual public CLI exercise; do not mutate live missions or change gates, tiers or CPU budgets. Any touched integration suite stays within 3.5 seconds.
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
