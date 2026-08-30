---
id: TASK-2428
title: Integrate safe review actions behind typed board commands
status: done
assignee: [codex]
created_date: '2026-08-28 06:29'
labels:
  - ai_sdlc
  - board
  - review
  - controller
dependencies:
  - TASK-2427
priority: high
---

## Description

Integrate the review action(s) that have a one-to-one checked application meaning behind typed board commands. Preserve reviewer/implementer separation, reviewed-revision identity, provider approval rules, and the existing review loop.

`review:submit`, `review:act-on-findings`, and `approve:review` are names in the board command vocabulary, but the existing review use case selects behavior from CLI-style flags. First characterize the exact current CLI/application semantics. Map only actions whose semantics are unambiguous and safe. Rename a misleading board kind if necessary rather than wiring the wrong operation to a convenient label.

`approve:review` must remain unavailable unless there is already a checked application path that records the correct approval subject/revision and respects the existing human/provider approval boundary. The generated `.dc.html` “approve by mutating state” behavior is forbidden.

## Acceptance Criteria

- [ ] #1 Tests characterize the existing review operations that the board intends to expose before controller changes are made.
- [ ] #2 Each enabled board review kind maps to exactly one trusted application operation; browser-facing requests contain no CLI flags, review text, shell strings, file paths or arbitrary option bags.
- [ ] #3 Starting/continuing review preserves current-work phases and reviewer-family constraints.
- [ ] #4 Acting on findings, if enabled, uses existing review artifacts/domain state and does not let the browser synthesize findings or resolutions.
- [ ] #5 Provider/human approval is not forged, inferred from lane, or written by UI state.
- [ ] #6 A review failure/blocked result leaves authoritative lifecycle/review state truthful and surfaces the failure.
- [ ] #7 Existing CLI review behavior and review-history projection remain unchanged.

## Agent-slop guardrails

- Do not map `review:submit` to whichever `--submit*` flag happens to have a similar name without proving semantics in tests.
- Do not parse review-round/blocking state from display flags when dedicated domain/projection fields exist.
- Do not auto-approve to make a UI path green.
- Do not make the browser a reviewer artifact store.
- Do not expose arbitrary comments/files/options over the initial board command API.

## Definition of Done

- [ ] #1 Characterization + board-dispatch tests cover every review kind enabled by this task.
- [ ] #2 A negative test proves approval cannot be fabricated through the board path.
- [ ] #3 Verification/static-analysis gates pass.
- [ ] #4 Final checkpoint states explicitly which review kinds are runnable and which intentionally remain unavailable, with reasons.
