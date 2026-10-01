---
id: TASK-2575
title: Make rebound prompts repair-capable across repositories
status: done
assignee: [claude]
created_date: '2026-09-25 11:28'
updated_date: '2026-09-25 11:33'
labels: []
dependencies: []
ordinal: 108008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parallix bouncebacks often fail where a direct operator prompt succeeds: “There are errors in <logs>; fix the mission without breaking the repo.” In task-2573, the integration agent-smoke rebound sent Codex a long generic prompt to reload locked mission scope, repair the named test/code path, and commit. Codex traced the Pi healthcheck timeout to an empty assistant turn from the configured vLLM interaction, decided that runner configuration was outside mission scope, and stopped. The trace does not show that vLLM was down. A second rebound exhausted the budget.

Make rebound prompts generally repair-capable for any repository. Give the agent the exact failed check and logs, the mission outcome, and the instruction to fix the mission without breaking the repository. Do not pre-decide that the fault is a test/code path inside the original mission scope, or that a code commit is always the remedy. Preserve safety boundaries and verification, but allow the agent to diagnose and repair the actual cause within its authority. When the cause is external and cannot be repaired by the agent, report that accurately and avoid repeated ineffective bounces. Measure success on representative gate, hook, and external-dependency failures.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Regression coverage includes repairable gate and hook failures plus an external model-healthcheck failure.
- [ ] #2 A rebound prompt supplies the exact failed check and logs, the mission outcome, and a requirement to preserve the repository without presuming a specific cause or repair location.
- [ ] #3 An authorized implementer can repair the actual repository or environment cause while preserving mission deliverables and safeguards.
- [ ] #4 An external blocker the agent cannot repair is reported accurately without repeated ineffective bounces.
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
