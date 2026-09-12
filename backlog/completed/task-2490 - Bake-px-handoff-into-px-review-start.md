---
id: TASK-2490
title: Bake px handoff into px review --start and retire the standalone command
status: done
assignee: [custom]
created_date: '2026-09-11 11:00'
labels:
  - ai_sdlc
dependencies:
  - TASK-2482
references:
  - src/interfaces/cli/runtime.ts
  - src/application/handoff-command-use-case.ts
  - src/adapters/review/review-commands.ts
  - src/application/ports/handoff-workflow.ts
  - prompts/execute-core.md
  - prompts/review-core.md
  - docs/agents.md
---

## Description

`px handoff` syncs, pushes, and transitions a mission to review. The review
lifecycle already begins with `px review <slug> --start`, which performs the
required verification and then launches the reviewer. Having a separate
`handoff` command creates a redundant, easy-to-skip transition: an agent can
forget to hand off, or hand off twice.

Bake the handoff transition into `px review <slug> --start` so starting a review
performs the sync/push and review-transition that `px handoff` currently does,
then remove the standalone `px handoff` command. This pairs with TASK-2482, which
removes the unused `px checkpoint` command; both retire commands that the review
lifecycle can own directly.

Trace the handoff-workflow port and `handoff-command-use-case` before merging:
preserve the gate repair, the behind-main rebase repair, and the checkpoint
validation that `px handoff` and `px active` currently rely on, and wire them
into the `--start` entry point where the review transition belongs.

## Acceptance Criteria
- [ ] #1 `px review <slug> --start` performs the sync/push and review-transition that `px handoff` previously performed; starting a review no longer depends on a separate handoff step.
- [ ] #2 `handoff` is no longer registered, advertised, suggested, or executable as a standalone command; its gate-repair and behind-main-rebase behavior is preserved through the `--start` path.
- [ ] #3 Existing callers of the handoff capability (including the `px active` post-execute handoff repair from TASK-1037) still function, routed through the review-start transition.
- [ ] #4 Live documentation and agent guidance no longer instruct agents to invoke `px handoff` separately from starting a review; historical mission records remain unchanged.
- [ ] #5 Focused regression checks and required repository verification, including static-analysis for code changes, pass.

## Definition of Done
- [ ] Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] Lint and static analysis report clean on every changed file
- [ ] No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] Docs updated to reflect any workflow or user-facing behavior change
- [ ] Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
