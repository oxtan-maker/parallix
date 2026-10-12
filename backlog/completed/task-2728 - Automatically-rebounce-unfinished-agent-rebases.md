---
id: TASK-2728
title: Automatically rebounce unfinished agent rebases
status: done
assignee: [codex]
created_date: '2026-10-12 07:08'
updated_date: '2026-10-12 07:09'
labels: []
dependencies: []
ordinal: 226008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When Parallix invokes an agent to resolve a rebase, an unfinished rebase currently stops the flow and requires manual intervention. Automatically retry through the existing rebounce mechanism when the agent leaves the rebase incomplete or the checkout on the wrong branch. Use the expected mission branch resolved before launching the agent as the completion target. The retry prompt must consist only of: "complete the rebase, ensuring the checkout ends at <branch>" with <branch> replaced by that expected branch. Recheck actual Git state after each attempt rather than trusting agent exit status or completion text.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An agent leaving a rebase in progress or unmerged files triggers automatic rebounce instead of immediately requiring manual intervention.
- [ ] #2 Completion requires no rebase in progress, no unmerged files, and the checkout on the expected mission branch; a wrong branch triggers recovery.
- [ ] #3 The retry prompt is exactly: complete the rebase, ensuring the checkout ends at <branch> (substituting the expected branch), with no additional instructions.
- [ ] #4 Retries use the existing bounded rebound policy; exhaustion reports actionable failure and prevents automatic push or further workflow advancement.
- [ ] #5 Existing hook-failure recovery continues to work without nested retry budgets or duplicate agent launches.
- [ ] #6 Focused regression coverage proves unfinished and wrong-branch outcomes recover, successful completion does not retry, and exhausted recovery cannot advance. Manually rehearse the flow in an isolated fixture repository.
- [ ] #7 Reuse the existing rebound kernel, retry budget and policy, agent launcher, mission transitions, and Git-state detection through existing ports. Do not introduce a parallel retry framework, separate agent-launch infrastructure, new persistence or configuration, or duplicate state detection. Any necessary extension must be minimal and justified by a demonstrated gap in existing infrastructure.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Before implementation, trace the existing rebase hook-failure rebound and shared-conflict agent completion paths in src/application/rebase-workflow.ts, the shared src/application/rebound-kernel.ts, and their existing ports and owning tests. Base the implementation on those actual contracts; do not invent infrastructure or assume unavailable APIs. Extend existing owning suites. Keep retry instructions limited to the exact requested prompt.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
