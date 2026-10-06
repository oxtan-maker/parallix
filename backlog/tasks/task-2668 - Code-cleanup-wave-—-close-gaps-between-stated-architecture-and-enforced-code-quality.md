---
id: TASK-2668
title: >-
  Code cleanup wave — close gaps between stated architecture and enforced code
  quality
status: backlog
assignee: []
created_date: '2026-10-06 13:51'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 176008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An adversarial architecture review (2026-10-06, reviewer persona: director/architect evaluating the repo as evidence of engineering leadership) found places where the repository's stated guarantees are not enforced by the code itself:

- Core application code runs with type checking disabled (`// @ts-nocheck` on 10 production files, ~4.8k lines, including the 1,630-line handoff use case that claims to reach the world only through typed ports).
- Command modules carried over from JavaScript still use JSDoc types, `@ts-ignore`, and `any` (~110 suppressions, ~530 `any` uses in `src/`).
- ESLint runs only syntactic rules; no type-aware rules guard `any`, unhandled promises, or complexity.
- Safety-relevant decisions (for example whether review may fall back to self-review) are made by matching error message text.
- `process.env` is read directly in ~50 production files instead of being resolved at the composition root.
- 27 production files are on the 500-line cap exception list; several exceed 1,000 lines.
- The domain layer is thin (~2.9k lines vs ~24k application and ~44k adapters), so business policy lives in use cases and adapters.

This parent groups the remediation as independently deliverable subtasks. The goal is that a skeptical reviewer reading the code finds the README and ADR claims (typed ports, mechanics in tested code, ports-and-adapters) true at the source level.

Constraints for all subtasks: follow AGENTS.md. Changes to ports-and-adapters principles, dependency direction, typed application ports, or composition authority require presenting evidence and alternatives to the operator and obtaining an explicit decision before implementation. Over-cap files are fixed by cohesive refactors, not mechanical splits.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All subtasks are done or explicitly descoped with a recorded reason
- [ ] #2 No production file under src/ or web/ disables type checking with @ts-nocheck
- [ ] #3 The repository's public claims about typed ports and tested mechanics hold at the source level
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
