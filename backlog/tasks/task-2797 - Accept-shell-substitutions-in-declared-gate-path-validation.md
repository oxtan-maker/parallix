---
id: TASK-2797
title: Accept shell substitutions in declared-gate path validation
status: backlog
assignee: []
created_date: '2026-10-20 10:34'
updated_date: '2026-10-20 10:40'
labels:
  - bug
dependencies: []
references:
  - 'http://localhost:3300/magnus/parallix/pulls/748'
priority: high
ordinal: 276008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The px-0017 real-agent smoke rerun failed when a valid declared shell gate containing $(./hello.sh) was rejected as a nonexistent literal file before execution. Current main src/application/handoff-declared-gates.ts gateCommandMissingFile splits whitespace, strips quotes/backticks, and treats the substitution syntax as part of a pathname. Existing owner test/unit/application/gate-validation-refactor.test.ts covers real missing paths plus URL/flag/glob exclusions but lacks substitution cases. Native Mission records and Backlog were checked; completed TASK-2221 and TASK-2439 are related gate trust/rebounce work, not an active duplicate. The active authorized integration-repair worker in px-0017 is already implementing this fix: coordinate with PR #748 rather than starting competing implementation. Main is not fixed until that reviewed mission lands. Preserve validation of genuinely missing scripts and all operator-owned gate commands, assertions and budgets.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing gate-validation suite retains a red-on-main regression accepting an existing relative script inside a valid shell substitution.
- [ ] #2 Missing scripts inside substitutions and ordinary missing-path commands still fail; quoting and existing URL/flag/glob contracts retain distinct assertions.
- [ ] #3 The original real-agent smoke command passes against the repaired committed tree without changing its gate command, assertions, selection or budgets.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation is underway in px-0017 retained integration repair. Link final commit and verification evidence here after review/integration; do not duplicate that work.

Recovery complete: px-0017 is approved in integration with clean worktree; approval covers 2b040996579267d03cb401e873c184d67293d4c9 (rebased validator fix from bf31426fa). Independent disposable-tree owning-suite verification: parent plus regression 14 pass/1 fail precisely on substitution; fixed tree 15 pass/0 fail, new case 0.408 ms. Missing scripts inside substitutions and after && remain rejected. Exact real-agent smoke passed on repair (131 s), then automatic harness rerun passed (140.3 s); declared verification passed. Gate commands, selection and budgets unchanged. Fix is reviewed in PR #748, not on main until operator integration; avoid duplicate implementation.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
