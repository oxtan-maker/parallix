---
id: TASK-2495
title: Remove the hallucinated px mission-start command
status: done
assignee: [custom]
created_date: '2026-09-11 11:00'
labels:
  - ai_sdlc
dependencies: []
references:
  - src/composition/create-cli.ts
  - src/adapters/cli/mission-start.ts
  - src/interfaces/cli/runtime.ts
  - src/adapters/mission/execute-mission-adapters.ts
  - prompts/act-on-review-core.md
  - prompts/draft-core.md
---

## Description

`px mission-start` is exposed as a dispatchable command and wired into the CLI
composition and the execute-mission adapters. It is a hallucinated command: no
workflow path invokes it as a required lifecycle step and it duplicates the
startup preflight that `px active` already performs. Its presence in help text
and prompts invites agents to call an unnecessary command.

Remove this command and its command-only wiring, help listing, suggestions, and
any prompt guidance that instructs agents to invoke it. Trace references before
deletion: anything that still legitimately needs a startup preflight must route
through `px active` (which already runs preflight). This task does not remove the
startup preflight capability itself.

## Acceptance Criteria
- [ ] #1 `mission-start` is no longer registered, advertised, suggested, or executable; invoking it cannot run its preflight logic.
- [ ] #2 Command-only implementation and wiring are removed, including the adapter entry in `execute-mission-adapters.ts` and any dead imports; the startup preflight capability still runs through `px active`.
- [ ] #3 Live documentation and agent guidance contain no instructions to invoke `px mission-start`; historical mission records remain unchanged.
- [ ] #4 Focused regression checks and required repository verification, including static-analysis for code changes, pass.

## Definition of Done
- [ ] Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] Lint and static analysis report clean on every changed file
- [ ] No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] Docs updated to reflect any workflow or user-facing behavior change
- [ ] Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
