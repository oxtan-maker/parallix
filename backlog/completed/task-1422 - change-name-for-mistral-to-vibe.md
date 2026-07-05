---
id: TASK-1422
title: change name for mistral to vibe
status: done
assignee: [custom]
created_date: '2026-07-04 13:47'
labels: ["user_value"]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
we have inconsisten naming for agents, codex and claude refers to the cli names, but mistral refers to the company. Change mistral naming in parallix to vibe (skip the model in stats, keep as is)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Summary

Completed checkpoints CP-1 through CP-5. Rename of `mistral` → `vibe` across lib/ source files, imports/exports, and templates. Test files mechanically updated (agent key renames, function name renames) as required by renamed module interfaces. Regression fixes from tasks #1415 and #1417 preserved (integrate.ts date derivation fix, verification.ts build freshness checks, package.json publish guard). Static analysis gate passes clean. All 2002 tests pass.

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
 - [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
