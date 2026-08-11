---
id: TASK-2360
title: 'Stop the workflow from demanding file:line evidence that rots'
status: done
assignee: [codex]
created_date: '2026-08-11 07:35'
labels:
  - ai_sdlc
  - workflow
  - documentation
dependencies: []
references:
  - src/application/handoff-command-use-case.ts
  - src/adapters/review/review-commands.ts
  - src/adapters/cli/commands/repair-handoff.ts
  - src/domain/checkpoint.ts
  - src/adapters/verification/gatekeeper.ts
  - docs/doc-standards.md
priority: high
ordinal: 88911
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parallix actively pushes agents toward `path/to/file.ts:<line>` citations, and those citations rot. The checkpoint evidence validator accepts a `file.ts:<n>` reference, the repair-handoff instructions offer one as the worked example, the gatekeeper and handoff prompts ask for "file:line, test names", and the project-level Definition of Done default literally requires the Goal Check table to cite "real evidence using file:line references".

The cost lands on later sessions. A line number in one file that another file asserts on breaks the moment either file is edited, and the agent that made the unrelated edit has no way to connect the two — it burns iterations chasing what looks like a random failure. TASK-2332.08 shipped exactly this: the auto-generated CP-1 template cited `handoff.ts:277` and a test in `test/handoff.test.ts` asserted that literal string. It was fixed there, but the incentive that produced it is still in place.

The validator does not even check the line: it only verifies that the cited *file* exists, so the number is decorative and always eventually wrong. Stale-proof forms are already accepted and should become the recommended ones — a backticked shell command with an existence-checked file argument, a `*.test.ts` path, a known test name, or an `ADR NNNN` reference.

Scope is the evidence contract and the guidance around it: what the workflow asks for, what the validator recommends, and the standing instructions and templates that put line numbers in front of agents. Historical `CP-N.md` checkpoints are frozen records and are out of scope; so is any change to what counts as *sufficient* evidence — a row must still cite something real.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No guard, test, or generated artifact in the repository asserts on a file.ts:<line> reference belonging to a different file, verified by a repository-wide check
- [ ] #2 A test or static check fails when a new file.ts:<line> citation is introduced into live authored documentation, an ADR, a prompt template, or generated evidence
- [ ] #3 The project-level Definition of Done default no longer instructs agents to cite file:line, and names stale-proof evidence forms instead
- [ ] #4 Handoff, gatekeeper, review, and repair-handoff guidance recommend stale-proof evidence forms, and no worked example in those prompts contains a line number
- [ ] #5 The evidence validator still rejects prose-only and shell-output-only rows: what counts as sufficient evidence is unchanged, only which form is recommended
- [ ] #6 Existing checkpoint documents under missions/ are left untouched and still validate
- [ ] #7 docs/doc-standards.md states the rule and the reason, so it applies to future authored documentation
- [ ] #8 ./scripts/verify-local.sh all passes
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
