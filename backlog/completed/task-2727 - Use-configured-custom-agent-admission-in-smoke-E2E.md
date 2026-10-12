---
id: TASK-2727
title: Use configured custom-agent admission in smoke E2E
status: done
assignee: [codex]
created_date: '2026-10-12 05:36'
labels:
  - ai_sdlc
dependencies: []
priority: medium
ordinal: 225008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The real-agent smoke harness has its own exclusive /tmp/parallix-real-agent-custom-model.lock held across the entire lifecycle. This serializes smoke runs even when the canonical repository config sets adapters.agents.maxConcurrentCustom to 2, and a stalled tool in one smoke run blocks another. Remove this independent test-owned concurrency policy and route smoke agent launches through production custom-agent admission with the canonical configured capacity. Preserve disposable repository and operator-state isolation; do not solve this by pointing smoke fixtures at the real operator database. Historical comments about backend instability are not sufficient justification for a separate hardcoded limit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The smoke harness no longer acquires or waits for its independent exclusive custom-model lock.
- [ ] #2 Concurrent smoke runs participate in the production custom-agent admission policy and honor the canonical configured capacity across worktrees, including capacity 2; separate disposable fixture repositories do not silently bypass the shared capacity.
- [ ] #3 Admission uses production ports and adapters with explicit composition, while smoke mission records, credentials, sessions, and mutable operator state remain isolated from real operator data.
- [ ] #4 Focused contracts demonstrate two admitted custom sessions at capacity 2, waiting at exhausted capacity, and capacity release after success, failure, cancellation, and process exit.
- [ ] #5 A manual concurrent smoke E2E replay demonstrates that one run waiting on a tool does not prevent another from using an available configured slot; preserve lifecycle assertions and finite timeout budgets.
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
