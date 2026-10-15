---
id: TASK-2759
title: Acknowledge retained blockers on explicit operator review --continue
status: done
assignee: [codex]
created_date: '2026-10-15 09:17'
labels: []
dependencies: []
ordinal: 247008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An operator who explicitly runs px review --continue should be able to resume a mission stopped by a retained invalid-contract blocker, just as explicit px active acknowledges that stop today. TASK-2746 reproduced the problem: code and stale contract checks were repaired, but review continuation still rejected the historical blocker. Reuse the application-owned operator-resume acknowledgment, preserve the diagnostic and proposed correction in history, and refresh open repair authorization against the current recorded contract. The command must then follow normal retained repair and review progression.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Explicit operator px review --continue acknowledges and clears retained blockers before checking retained repair readiness; inferred mission slugs and explicit slugs both work.
- [ ] #2 Preserve the prior blocker, proposed correction, acknowledgment actor and timestamp; refresh authorization for open repair checkpoints to current recorded gates and success criteria.
- [ ] #3 Acknowledgment records no repair evidence, grants no approval and marks no verification complete. Missing diagnostics, missing checkpoint evidence, failing original checks and newly reported blockers still stop recovery.
- [ ] #4 Automatic, borrowed and nested review continuation carries no operator acknowledgment authority and cannot silently clear blockers.
- [ ] #5 Reuse typed application ports and the existing acknowledgment service; keep composition responsible for distinguishing direct operator invocation.
- [ ] #6 Add focused red-to-green coverage in the owning review-resume suites, including real CLI recovery with isolated Git and SQLite fixtures; update operator documentation and run required focused/static checks.
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
