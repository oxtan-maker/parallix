---
id: TASK-2631
title: success criteria get completion checkboxes instead of verbatim evidence matching
status: backlog
assignee: []
created_date: '2026-10-02 09:00'
labels: [ai_sdlc]
dependencies: []
---

## Problem

Handoff requires each final checkpoint Goal Check row's `criterion` text to
match a success criterion (SC) **verbatim** (case/whitespace/number-normalized
token equality). The intent is good: stop an agent recording a row like
`"works"` that maps to no SC. But the verbatim requirement is brittle against
hallucinating agents, which mis-copy long SC prose (e.g. dropping an `(e.g. ...)`
clause). The failure here was a copy slip, not a real gap.

## Proposal

Decouple "agent claims done" from "agent paraphrased the SC":

- SCs carry a completion flag (CLI checkbox), not an inferred text match.
- Agent marks done via `px mission mark-complete --slug <slug> --sc N`
  (repeatable, or `--all`). The CLI takes a real SC index, so the mapping
  cannot be fabricated.
- `px status` shows `SC1 [X] SC2 [ ]` inline.
- Handoff checks two things, both still enforced:
  1. every SC is marked done, and
  2. each done SC has a checkpoint row with a **verifiable** evidence
     reference (command / test name / ADR / file path) — but the evidence is
     NOT text-matched against the SC string.

This keeps the real defense (verifiable evidence) and drops the brittle layer
(verbatim wording), which is exactly the brittleness agents trip on.

## Design notes

- Domain: `Mission.successCriteria` is `readonly string[]` today
  (`src/domain/mission.ts`, `src/domain/mission-success-criteria.ts`). Move to
  `{ text, done }` entries or a parallel `done` set. Migrate existing missions.
- New CLI verb: `px mission mark-complete`. Completion is a non-lane op, so it
  records an `operational_history` row, not a lane event.
- `px status` output appends `[X]`/`[ ]` per SC.
- Handoff gate (`src/application/handoff-command-use-case.ts`) replaces the
  verbatim comparison with: all SCs done AND each has verifiable evidence.
- Test rewrite: `test/mission-handoff-use-case-contract.test.ts` asserts
  verbatim behavior; change to checkbox behavior.
