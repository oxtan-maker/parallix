---
id: TASK-2641
title: Human review must reach the review loop and supersede stale agent approval
status: done
assignee: [codex]
created_date: '2026-10-03 16:49'
labels:
  - bug
dependencies: []
priority: high
ordinal: 159008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2640 / Forgejo PR #582 reproduction: Magnus requested all completed missions (ai_sdlc is also product value) and a rounded 2/week manual proxy on 2026-10-03 at 18:29 local time. Later agents followed database findings and reverted those operator corrections. Dismissing the round-4 provider approval and continuing launched an implementer that saw APPROVED with no unresolved findings, produced no resolution artifacts, and exhausted two artifact retries. Root causes: review-artifacts.ts imports human notes only after artifact persistence; review-events.ts stores comments as human_note rather than actionable findings; status review history omits those notes; act-on-review-core.md directs agents to that incomplete status as authority. Provider dismissal does not revoke the stored Review decision. Preserve database authority but reconcile explicit human intervention through the existing application ports before selecting or launching a review phase. Do not solve by increasing retries or creating another statistics/review authority.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Focused owning-suite regression reproduces an operator request after agent approval and fails on parent behavior.
- [ ] #2 Human review bodies and inline comments are available to both reviewer and implementer before launch, with original author, source identity, and current/dismissed state; imported notes appear in agent-facing status.
- [ ] #3 Explicit operator change requests reconcile the stored approval and enter an actionable repair round; dismissed provider approvals cannot silently authorize continuation.
- [ ] #4 Continue after human intervention cannot launch an approved no-findings repair and then exhaust artifact recovery; no-op and genuine repair outcomes have explicit protocol handling.
- [ ] #5 Reviewer sees operator corrections and reasons; stale mission evidence cannot silently override them. Preserve review history and deduplicate provider feedback without losing edits.
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

## Investigation and initial mitigation

Both stage prompts now require reading `px review <slug> --comments` before evaluating stored review state, honoring explicit operator corrections, and reporting provider/database conflicts. A focused regression in the existing review-prompt-evidence contract fails on parent 72fc2a844 and passes with the prompt fix. This is an initial mitigation: automatic pre-launch ingestion, status projection of human notes, author preservation, actionable human decisions, and robust restart reconciliation remain open. The existing `px revoke-review` command can reopen this mission through the canonical lifecycle without deleting history.
