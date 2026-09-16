---
id: TASK-2524
title: Task-file rename this week created slug duplicates that block completeTask closeout
status: done
assignee: [codex]
created_date: '2026-09-16 12:40'
labels: [bug, ai_sdlc]
dependencies: []
ordinal: 74022
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Missions landed this week leave their `backlog/tasks/` file stuck on
`status: backlog` even though the work is merged and the SQLite Mission
aggregate is `done`. This is not a landing-sequence regression — it is a
task-file resolution collision that turned a pre-existing guard into a dead end.

The mechanism, verified at `main` head (`a6d51e0a3`):

1. `resolveTaskFile(slug)` matches by **filename prefix**
   (`src/adapters/backlog/task-file-io.ts`, `findTaskFiles`: `f.startsWith(slug)`).
2. When two files share a slug prefix — a stale original in `backlog/tasks/`
   plus the mission's renamed file in `backlog/completed/` — `resolveTaskFile`
   returns `{ ok: false, reason: 'ambiguous' }` (the `preferSameTaskInHigherPriorityDir`
   helper only disambiguates when the candidates share a basename).
3. `completeTask()` (`src/adapters/backlog/task-transitions.ts`) short-circuits
   on `!resolution.ok` and returns `false` without moving the file. The open
   `tasks/` file therefore never advances to `done`/`completed/`.

Empirical confirmation:

```
resolveTaskFile('task-2503', cwd) -> { ok: false, reason: 'ambiguous' }
  tasks/task-2503 - prevent-autobug-filing-on-test-run.md
  completed/task-2503 - preserve-mission-identity-during-rebase.md
```

The collision is new this week. Before ~2026-09-14 each slug had exactly one
file, so `resolveTaskFile` returned it unambiguously and `completeTask` moved
it cleanly. The drift set (DB `done` but `tasks/` still open) was:

| slug | stale `tasks/` file | renamed `completed/` file |
| --- | --- | --- |
| task-2503 | `prevent-autobug-filing-on-test-run` | `preserve-mission-identity-during-rebase` |
| task-2518 | `Keep-board-action-wire-vocabulary-in-sync` | (same title) |
| task-2519 | `Shift-rigth` | (same title) |

All three are this week's missions. The `ambiguous`-resolution logic itself is
old (added in `9e5ae42b1` / task-2369.14, 2026-08-13); the **duplicates** are
what is new.

## Non-regression constraints (must not break)

<!-- NONREG:BEGIN -->
- Do NOT touch `src/application/rebase-workflow.ts` or
  `test/task-2503-repro.test.ts` (task-2503's identity-preservation fix).
- Do NOT change the integration landing sequence, gate selection, or the
  pre-landing integration guard (TASK-2517).
- Do NOT make `resolveTaskFile` silently pick a file globally — the ambiguity
  must still surface as an integrity error for `px status`/board display. Only
  `completeTask` may prefer the open file to preserve its advance contract.
<!-- NONREG:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 The drifted files are corrected (task-2503, task-2518, task-2519 →
  `done`) so the board matches the landed state
- [ ] #2 `completeTask` advances the open `tasks/` file when the ambiguity is
  exactly an open-file-vs-completed-file twin, so a stale rename can no longer
  block closeout
- [ ] #3 No new slug duplicates are introduced; a committed integrity check
  fails when two files share a task slug prefix
- [ ] #4 The stale `tasks/` duplicate is removed on closeout, not left behind
  and not silently overwriting the completed/ mission file
<!-- AC:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Red-to-green reproduction: a committed check that fails when a merged
  mission's `tasks/` file is left open and passes after the fix
- [ ] #2 `./scripts/verify-local.sh static-analysis` clean on every changed file
- [ ] #3 No focused or unannotated skipped tests introduced (no `.only`, no bare
  `.skip`)
- [ ] #4 Final checkpoint Goal Check cites real evidence with `file:line` and
  test names
<!-- DOD:END -->
