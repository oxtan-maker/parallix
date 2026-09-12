---
id: TASK-2494
title: Fix agent fallback after usage blocks during rebase handoff
status: done
assignee: [custom]
created_date: '2026-09-11 12:23'
labels:
  - bug
  - ai_sdlc
  - agents
  - rebase
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a pinned implementer hits a usage limit while resolving a rebase conflict, the launcher records the AgentBlock but refuses a family fallback. The handoff path then classifies the resulting pinned-agent error as an infrastructure blocker, incorrectly directing the operator to Forgejo credentials/network checks. Preserve the original usage-block context and select an eligible replacement family when policy permits; never misclassify an agent-capacity failure as Forgejo infrastructure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A usage-blocked implementer during rebase conflict resolution selects an eligible replacement family when the mission policy allows substitution.
- [ ] #2 If substitution is forbidden, the final handoff message identifies the agent usage block and reset time without calling it an infrastructure or Forgejo failure.
- [ ] #3 Regression coverage exercises the rebase-handoff path from detected usage limit through final diagnostic.
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
