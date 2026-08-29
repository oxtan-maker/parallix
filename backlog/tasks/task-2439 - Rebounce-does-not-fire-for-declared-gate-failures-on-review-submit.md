---
id: TASK-2439
title: Rebounce does not fire for declared gate failures on review --submit
status: backlog
assignee: []
created_date: '2026-08-28 16:06'
labels: [ai_sdlc, bug]
dependencies: []
ordinal: 122917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px review <slug> --submit` on mission task-2431 was hard-blocked at Step 2.6 by a
declared-gate failure that is deterministic and machine-fixable, yet no rebounce to
the implementer happened — the operator was left with a raw bash error and a stranded
task ("Blocking handoff — task remains in active"). This is the same failure mode
TASK-2353 ("Rebounce does not work") was supposed to eliminate.

Reproducing log:

```
[INFO] Step 2.6: Running declared gates from MISSION.md...
[INFO]   Gate: ./scripts/verify-local.sh all (CP-4: exit 0, 0 test failures)
[FAIL] Declared gate "./scripts/verify-local.sh all (CP-4: exit 0, 0 test failures)" failed for task-2431: bash: -c: rad 1: syntaxfel nära den oväntade symbolen ”(”
[FAIL] bash: -c: rad 1: `./scripts/verify-local.sh all (CP-4: exit 0, 0 test failures)'. Blocking handoff — task remains in active.
```

Root causes observed:

1. `validateDeclaredGates` (src/application/handoff-command-use-case.ts) accepts a
   parenthesized prose suffix. It rejects outcome-word suffixes ("… passes on the
   final tree"), dash-separated prose, and unmatched parens, but
   `./scripts/verify-local.sh all (CP-4: exit 0, 0 test failures)` has balanced
   parentheses and no outcome word, so it passes validation and is executed verbatim
   through `bash -c`, producing a shell syntax error instead of the clean
   "Gate declaration must contain an exact runnable command only" validation error.
2. The handoff Step 2.6 path hard-blocks on every declared-gate failure. The rebound
   kernel is only wired into the `px active` loop and the review-loop pre-review
   gate; a standalone `px review <slug> --submit` failure never reaches it, so a
   deterministic error ends in human interruption instead of a bounded bounce-back
   to the implementer.
3. The MalformedGates classifier patterns are English-only ("syntax error"); bash
   error text is locale-dependent (Swedish here: "syntaxfel nära den oväntade
   symbolen"), so even a classified error would fall through to GateFailure/default
   rather than MalformedGates (AutoRepair).

Adhoc unblock applied on this branch: the two malformed gate lines in
missions/task-2431/MISSION.md were reduced to the exact runnable commands
(`./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`); the
outcome expectations remain in Success Criteria and CP-4.md.

<--- Last few GCs --->
(none — this is a workflow bug, not a runtime crash)

<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- A declared gate containing a parenthesized (or otherwise non-command) suffix is rejected by `validateDeclaredGates` with the "exact runnable command only" error instead of reaching `bash -c`.
- A declared-gate failure during `px review <slug> --submit` is classified per ADR 0048 and dispatched through the rebound kernel (AutoRepair for MalformedGates, AutoSendBack for GateFailure) with bounded retries, instead of hard-blocking with "task remains in active".
- Failure classification does not depend on the operator's shell locale; a localized bash syntax-error message classifies identically to the English one.
- Red-to-green reproduction test: a mission with a parenthesized gate declaration reproduces the hard block before the fix and a classified rebounce after.
<!-- AC:END -->
