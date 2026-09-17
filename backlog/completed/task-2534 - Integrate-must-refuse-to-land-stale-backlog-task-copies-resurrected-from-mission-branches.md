---
id: TASK-2534
title: >-
  Integrate must refuse to land stale backlog/tasks copies resurrected from mission branches
status: done
assignee: [claude]
created_date: '2026-09-17 14:00'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 90300
---

## Description

Missions that are already closed keep showing up again in `backlog/tasks/`
after an unrelated mission lands. TASK-2524 (landed in `9abfab5c0`) fixed only
one symptom: `completeTask(slug)` now removes the leftover `tasks/` copy of
**the mission that is landing**. It does nothing about leftover copies of
**other** tasks that the squash carries in. So the drift keeps coming back.

### Evidence (main as of `f9fc654a1`, 2026-09-17)

Ten `backlog/tasks/` files had a matching file for the same task in
`backlog/completed/` or `backlog/archive/tasks/`. The operator database
recorded most of those missions as `done`:
task-2505 (archived), task-2509, task-2510, task-2512, task-2513, task-2518,
task-2519, task-2524, task-2525.01, task-2526. They were removed by hand in the
`backlog: remove stale task copies` commit that files this ticket.

How they came back (verified with `git log --all --name-status`):

- `fd6b0d485 mission/task-2525.02` **added** `backlog/tasks/task-2518`,
  `task-2519`, `task-2524`, `task-2525.01`, and `task-2526` to main.
  `completed/` copies for all five were already on main, from `5ac4f6eeb`
  and `9abfab5c0`. `tasks/task-2518` had **never** existed on main before.
- `9abfab5c0 mission/task-2526` added `tasks/task-2509`, `task-2510`, and
  `task-2513` while their `completed/` copies were already on main.
- The added files come from the mission branch's **unsquashed history**. That
  history includes pre-squash commits of other missions (for example
  `fec483ac5 mission/task-2512` adds `tasks/task-2518`). The main-side deletions
  and renames only exist in main's squash commits. The squash merge sees
  "added on branch, absent at merge-base and on main" and adds the file.
- Agents make it worse during rebase. `ef04eb307` ("backlog: restore shared
  task files to main after rebase", on `mission/task-2528`) copies the
  already-polluted main state back into the branch.

These mission branches would still add stale copies if landed today (`git diff
--diff-filter=A main...<branch> -- backlog/tasks`, keeping ids whose file is
already in `completed/` or `archive/tasks/`):

| branch | would add |
| --- | --- |
| mission/task-2489 (integration) | task-2503, 2519, 2524, 2525.01, 2525.02 |
| mission/task-2478 (integration) | task-2527 |
| mission/task-2525 | task-2518, 2519, 2524, 2525.01, 2525.02 |
| mission/task-2522, mission/task-2235 | task-2518 (+2519) |

### Root cause

`squashAndLand` (`src/application/integrate/squash.ts`) takes **every** path
staged by `git merge --squash` as the landed payload (`intendedPayloadPaths`)
and never checks backlog paths. Nothing on the landing path runs a repo-wide
duplicate check:

- `checkBacklogIntegrity()` (`src/adapters/backlog/task-file-io.ts`) already
  finds `duplicate-completed`, but only `draft-stats.ts` calls it, and only
  for one slug.
- `pruneStaleBacklogDuplicates()` in the same file already removes exactly these
  files, but nothing in `src/` calls it (dead code).
- No committed test/gate asserts the **real repository** has zero
  `duplicate-completed` issues, so CI stays green while main is polluted.

## Required fix (the one choke point)

Every local landing goes through `squashAndLand`. Fix it there, once:

1. After `squashMerge(...)` and **before** `intendedPayloadPaths` is captured,
   find every staged path under `backlog/tasks/` whose task id already has a
   file in `backlog/completed/` or `backlog/archive/tasks/` **at `HEAD` of the
   base branch**. Unstage and delete those paths
   (`git reset -q HEAD -- <path>`, then remove the file from the working tree)
   so they never enter the payload. Log each one at `fmt.log.info` with the task id
   and the canonical path. Reuse `checkBacklogIntegrity` or
   `pruneStaleBacklogDuplicates`. Do not write a third scanner.
2. After `stageCloseout(...)` and before `commitLandedSquash(...)`, run
   `checkBacklogIntegrity(baseWorktree)` repo-wide. If any
   `duplicate-completed` issue remains, abort through `abortWith(landing, ...)`
   and list the offending paths. This check is the fail-closed backstop for
   anything step 1 missed.
3. Apply the same rule on the GitHub PR landing path
   (`src/application/integrate/github-pr.ts`) if it builds a payload from a
   branch merge. If it does not, say so in the checkpoint with a `file:line`
   citation. Do not guess.
4. Add a repo-state test (unit tier, reads the real checkout, no git calls).
   It must assert that
   `checkBacklogIntegrity(repoRoot).filter(i => i.type === 'duplicate-completed')`
   is empty. This is the CI guard that TASK-2524 AC #3 promised but never
   delivered.

## Non-regression constraints (must not break)

<!-- NONREG:BEGIN -->
- Do NOT delete or skip **new** task files that a mission legitimately files
  (e.g. `mission/task-2527` filed task-2528/task-2529; `mission/task-2525.02`
  filed task-2533). Only paths whose task id already has a `completed/` or
  `archive/tasks/` file on the base branch count as stale.
- Do NOT touch the TASK-2524 `completeTask` twin handling
  (`src/adapters/backlog/task-transitions.ts`) or its test
  `test/task-2524-slug-duplicate-closeout-repro.test.ts`.
- Do NOT change `resolveTaskFile` ambiguity semantics. Ambiguity must still show
  up in `px status`/board (TASK-2524 NONREG).
- Do NOT touch `src/application/rebase-workflow.ts` or
  `test/task-2503-repro.test.ts` (TASK-2503 identity-preservation fix).
- Do NOT change landing order, gate selection, the `--only` payload scoping,
  the `-z` payload capture (TASK-2533), or the pre-landing integration guard
  (TASK-2517).
- Do NOT rewrite main's history and do NOT force-push. Do NOT push mission
  branches to `origin` (AGENTS.md).
<!-- NONREG:END -->

## Agent guardrails (read before writing any code)

- **Reproduce first.** Write the red test before changing `squash.ts`.
  Build a throwaway repo (integration-ci tier; register it in
  `test/lib/test-categories.ts`) with:
  - main containing `backlog/completed/task-9001 - x.md`
  - a mission branch whose history adds `backlog/tasks/task-9001 - x.md` and
    one genuinely new `backlog/tasks/task-9002 - new.md`

  Run the real squash-landing code path. Assert that the landed commit does
  **not** contain `tasks/task-9001`, **does** contain `tasks/task-9002`, and
  that the log names task-9001. Show that the test fails on current main in
  the checkpoint, with the exact failure line.
- **No mock-only proof.** A unit test that stubs `git` and asserts the stub was
  called does not count as the reproduction. The git behavior (squash adding
  a file that is absent at the merge-base) is the bug.
- **No hand-cleanup as the fix.** Deleting files from `backlog/tasks/` in the
  mission diff is not a fix. The repo is already clean at the time of filing.
  If the repo-state test (step 4) fails on your branch, the cause is your
  branch history. Fix the landing code, not the data.
- **No agent "restore main's backlog" commits.** Do not add commits like
  `ef04eb307` that copy main's `backlog/tasks` into the branch. If rebase
  conflicts touch `backlog/`, take main's side for files you do not own and do
  not add files you do not own.
- **Stay in scope.** Touch only `src/application/integrate/squash.ts`,
  `src/application/integrate/github-pr.ts` (only if step 3 requires it),
  `src/adapters/backlog/task-file-io.ts` (only to reuse or export existing
  helpers), and the new tests. Any other file needs a written reason in the
  checkpoint. No drive-by refactors, renames, formatting sweeps, or new
  abstractions (no `BacklogPayloadFilter` class, no strategy object, no config
  flag). One helper function at most.
- **No new dependencies.** Node built-ins and existing helpers only.
- **No weakened checks.** Do not add `.skip`, `.only`, `todo`, try/catch that
  swallows the integrity abort, `|| true`, or a "warn only" mode for step 2.
- **No invented evidence.** Every Goal Check row cites a real `file:line`
  and a test name that exists in the final tree and passes. Paste the actual
  command output tail. "Should work" or "verified manually" is a failed
  checkpoint.
- **Docs only if meaning changes.** If you document anything, write one
  sentence in the integration behavior docs that says stale backlog copies are
  dropped at landing. Do not list paths or line numbers (AGENTS.md
  documentation rules).

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Landing a mission whose branch history adds a `backlog/tasks/` file
  for a task id that already has a `completed/` or `archive/tasks/` file on
  the base branch lands without that file. The landed commit does not contain
  it.
- [ ] #2 New task files filed by the mission (no canonical twin on the base
  branch) still land unchanged.
- [ ] #3 `px integrate` aborts before the squash commit if any repo-wide
  `duplicate-completed` issue remains after closeout.
- [ ] #4 A committed repo-state test fails when the real repository has any
  `duplicate-completed` issue and passes on the cleaned tree.
- [ ] #5 Landing `mission/task-2489` or `mission/task-2478` (dry run or the
  reproduction fixture that mirrors them) would no longer add the stale copies
  listed in the description.
<!-- AC:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Red-to-green reproduction: the integration-ci git fixture test
  described in the guardrails fails on `f9fc654a1`-era code and passes after
  the fix
- [ ] #2 `./scripts/verify-local.sh static-analysis` clean on every changed file
- [ ] #3 `./scripts/verify-local.sh all` passes on the final tree with captured
  output
- [ ] #4 No focused or unannotated skipped tests introduced (no `.only`, no bare
  `.skip`)
- [ ] #5 Final checkpoint Goal Check cites real evidence with `file:line` and
  test names
- [ ] #6 Diff touches only the files allowed under "Stay in scope" (or each
  extra file has a written reason)
<!-- DOD:END -->
