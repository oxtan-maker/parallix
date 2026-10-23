---
id: TASK-2812
title: Clarify existing rebase conflict-resolution instructions
status: backlog
assignee: []
created_date: '2026-10-23 05:27'
updated_date: '2026-10-23 19:56'
labels: []
dependencies: []
priority: high
ordinal: 291008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make a small improvement to the existing rebase/conflict-resolution instructions so the agent can resolve an ordinary rebase using Git and repository context.

When a rebase unexpectedly tries to replay old inherited work, instruct the agent to inspect the target branch, history and actual changes before resolving conflicts. Preserve the Mission changes and current base behavior; do not restore obsolete code or task metadata merely to make an old commit apply. Use ordinary Git rebase tools when the intended range is clear, and explain the specific uncertainty when it is not. Keep the instructions short and actionable.

Scope is existing instruction/prompt text only, plus a minimal adjustment to an existing prompt assertion if needed. Reuse the current rebase and conflict-agent workflow. No new replay-selection algorithm, historical-base tracking, retained Git refs, database state, persistence, ports, adapters, automatic history-proof system or new mandatory rebase refusal conditions. No new test suite or verification gate.

This scope replaces the previous squash-aware rebase capability specification. The existing broad implementation on this Mission branch is rejected as a deliverable: remove its production machinery, persistence/ref lifecycle, dedicated tests and expanded recovery documentation from the final Mission diff, preserving unrelated work. Do not integrate the previous implementation under this rewritten ticket. Earlier checkpoints, approvals and verification claims for that implementation do not establish completion of this scope.

Verification should match the small instruction change: review the rendered instructions and use the existing focused prompt checks where applicable. If manually exercising Git behavior, use a disposable repository. Do not touch running Missions, live workflow state or operator-owned gates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The final Mission diff contains only concise changes to existing rebase/conflict-resolution instructions and any strictly necessary existing prompt assertion; the rejected squash-aware machinery and its dedicated artifacts are absent.
- [ ] #2 Instructions tell the agent to inspect unexpected inherited replay, preserve intended Mission changes and current base behavior, and avoid resurrecting obsolete changes; ordinary Git tools remain sufficient.
- [ ] #3 No persistence, retained base refs, new replay-selection logic, new runtime contracts or refusal gates, new test suites, or verification-gate changes are introduced.
- [ ] #4 Review the final rendered instructions and run applicable existing focused checks; any manual exercise uses isolated state and leaves running Missions untouched.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Final diff reviewed against the instruction-only scope; rejected implementation is not included.
- [ ] #2 Applicable focused instruction checks pass; no new gates or live Mission mutations.
<!-- DOD:END -->
