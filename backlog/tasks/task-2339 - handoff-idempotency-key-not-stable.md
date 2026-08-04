---
id: TASK-2339
title: handoff idempotency key not stable across retries
status: refined
assignee: [custom]
created_date: '2026-08-04 10:42'
updated_date: '2026-08-04 10:42'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`performHandoff` generates idempotency key as `handoff-${slug}-${Date.now()}` (`src/adapters/cli/commands/handoff.ts:738`). Timestamp makes every retry get a new key, so idempotency never deduplicates. When handoff relaunches agent (e.g. gatekeeper pushback), the second `submit-for-review` transition hits domain check `requireStatus(mission, ['active'])` in `src/domain/mission-workflow.ts` line 59 and fails with `Cannot submit-for-review while task-XXXX is review; expected active`.

Same pattern in `src/adapters/cli/commands/integrate.ts:1299` (`integrate-${context.slug}-${Date.now()}`).

Two possible fixes:
1. **Domain fix (preferred)**: allow `submit-for-review` when status already `review` — treat as idempotent no-op returning current state
2. **Key fix**: use stable key `handoff-${slug}` or `handoff-${slug}-${reviewRound}` instead of timestamp

Domain fix covers all callers and matches the idempotency intent.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
