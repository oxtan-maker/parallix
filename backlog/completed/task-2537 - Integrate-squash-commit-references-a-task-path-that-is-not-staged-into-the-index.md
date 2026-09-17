---
id: TASK-2537
title: >-
  Integrate squash commit fails "pathspec did not match" when the moved backlog
  task path is not a tracked HEAD file
status: done
assignee: [claude]
created_date: '2026-09-18 09:20'
labels:
  - bug
  - ai_sdlc
dependencies:
  - TASK-2533
priority: high
ordinal: 90201
---

## Description

`px integrate` aborts at the final landing step with:

```
[FAIL] Could not create the squash commit in the local integration checkout.
[FAIL] fel: sökvägsangivelsen
       ”backlog/tasks/task-2535 - Restore-the-90-line-coverage-gate-by-covering-low-coverage-modules.md”
       motsvarade inte några av git kända filer
```

("pathspec did not match any git-known files".) This is a *different* failure
from task-2533. 2533 failed because git **quoted** backslash/non-ASCII
filenames in `git diff --name-only`; that is fixed with `-z`. This failure has
no quoting in play — the path is an ordinary ASCII filename with a space — it
fails because the path the commit names is simply **not present in the index**
at commit time.

## Root cause

The landed-squash step (`src/application/integrate/squash.ts`,
`squashAndLand` → `stageCloseout`) builds the commit payload as:

```js
const originalTaskPath = path.relative(baseWorktree, mainTaskFile); // backlog/tasks/<slug>
intendedPayloadPaths.add(originalTaskPath);
const completedTaskPath = ...; // backlog/completed/<slug>
intendedPayloadPaths.add(completedTaskPath);
git(['-C', baseWorktree, 'add', '-A', '--', originalTaskPath, completedTaskPath]);
// ...
git(['-C', baseWorktree, 'commit', '--only', '-m', ..., '--', ...intendedPayloadPaths]);
```

`backlog.completeTask(slug, baseWorktree)` **moves** the task file
`backlog/tasks/<slug>` → `backlog/completed/<slug>` on disk. When
`backlog/tasks/<slug>` is **not a tracked file on the base branch** (the mission
task file is authored on the mission branch by `px draft`, so the base/main
branch never carries it), the move leaves the following index state:

- `backlog/completed/<slug>` is staged as an **add** → matches the `--only`
  pathspec. ✓
- `backlog/tasks/<slug>` is **not in the index at all** (no HEAD entry to
  delete, and it is gone from disk after the move) → it does **not** match the
  `--only` pathspec.

`git commit --only` fails-closed when any named pathspec matches nothing
staged, so the landed squash aborts with the error above.

This is distinct from 2533: 2533 was about *git quoting* special characters in
the capture path; the path here is a plain space-containing ASCII name. The
`-z` capture fix does not help, because the problem is not the captured form —
it is that the tasks path never becomes a live index entry for `--only` to
match.

## Reproduction (exact, offline)

```bash
cd /tmp && rm -rf repro2 && mkdir repro2 && cd repro2
git init -q && git config user.email t@t && git config user.name t
mkdir -p backlog/tasks && echo base > missions/task-2535/MISSION.md
git add -A && git commit -qm init
# base branch does NOT track tasks/<slug> (true for a draft-authored task file)
printf 'taskbody' > "backlog/tasks/task-2535 - Restore-the-90-line-coverage-gate.md"
mkdir -p backlog/completed
git mv "backlog/tasks/task-2535 - Restore-the-90-line-coverage-gate.md" \
       "backlog/completed/task-2535 - Restore-the-90-line-coverage-gate.md"
git add -A -- \
  "backlog/tasks/task-2535 - Restore-the-90-line-coverage-gate.md" \
  "backlog/completed/task-2535 - Restore-the-90-line-coverage-gate.md"
git commit --only -m squash -- \
  "backlog/tasks/task-2535 - Restore-the-90-line-coverage-gate.md" \
  "backlog/completed/task-2535 - Restore-the-90-line-coverage-gate.md"
# fel: sökvägsangivelsen ”backlog/tasks/task-2535 - ...md”
#     motsvarade inte några av git kända filer
```

## Non-regression constraints (must not break)

- Missions whose task file **is** already tracked on the base branch must still
  land exactly as before (tasks delete + completed add both in the index).
- Do not change what lands, only how the closeout stages the move so both ends
  are valid `--only` pathspecs.
- Keep the `--only` scoping; the commit must still name only the intended
  payload so a concurrent bare-board commit never inherits ambient index
  entries.

## Acceptance Criteria

- [ ] #1 A mission whose task file is authored on the mission branch (absent
  from the base branch) lands without the "pathspec did not match" abort.
- [ ] #2 A mission whose task file already exists on the base branch still lands
  identically (same files, same commit).
- [ ] #3 The landed squash commit contains both the removed `backlog/tasks/<slug>`
  and the added `backlog/completed/<slug>`.

## Definition of Done

- [ ] #1 Verification gate ran and passed on the final tree with captured proof
  rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests introduced (no .only, no bare
  .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line
  references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that
  fails before the fix and passes after

## Implementation guidance (minimal)

Stage the closeout move so both paths are live index entries before the
`--only` commit. Prefer an explicit rename so git records the delete+add for
both paths even when the source path is not a tracked HEAD file, e.g. ensure
`backlog/tasks/<slug>` is staged (add, if it is only in the worktree) **before**
removing it, or stage the rename with `git add -A` scoped to the backlog tree
rather than passing a now-absent source path to `--only`. The invariant to
enforce: every path in `intendedPayloadPaths` must resolve to a staged index
entry at commit time — verify before committing and fail-closed with an
actionable hint otherwise.

## Regression test

`test/task-2537-squash-closeout-unstaged-task-path.test.ts` (integration-ci):
builds a throwaway repo where `backlog/tasks/<slug>` is absent from the base
branch, runs the closeout+commit sequence, and asserts the landed squash commit
contains both the tasks removal and the completed add without a pathspec abort.
