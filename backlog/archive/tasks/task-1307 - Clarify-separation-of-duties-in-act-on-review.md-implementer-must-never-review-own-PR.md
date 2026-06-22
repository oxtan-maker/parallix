---
id: TASK-1307
title: >-
  Clarify separation of duties in act-on-review.md: implementer must never
  review own PR
status: backlog
assignee: []
created_date: '2026-06-14 15:38'
updated_date: '2026-06-15 20:40'
labels:
  - agent-prompts
  - separation-of-duties
  - act-on-review
dependencies: []
priority: high
ordinal: 750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The act-on-review.md agent prompt currently lacks an explicit rule that the implementer must never submit a review verdict (approve/request-changes) on their own PR. The prompt says "Do NOT post to Forgejo directly" but this is ambiguous — an implementer could interpret it as "post comments but not PR reviews."

Update docs/agent-prompts/act-on-review.md to add a clear, explicit rule under the Contract section:

"The implementer must NEVER submit a review verdict (approve/request-changes) on their own PR. Review submission (node parallix review <slug> --submit-review) is exclusively the reviewer's responsibility. The implementer may only push commits and use --push/--comments/--status."

This prevents a single agent from both fixing issues and approving their own fixes, which defeats the review process entirely.
<!-- SECTION:DESCRIPTION:END -->
