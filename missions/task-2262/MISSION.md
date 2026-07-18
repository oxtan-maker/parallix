# Mission: Commit the handoff NEL record before the review-transition rebase (task-2262)

## Goal

Make `performHandoff` durably commit the mission's freshly captured `nel-record.json`
before `transitionTask` rebases the mission worktree onto the branch that owns Backlog
state. A handoff must not stall with an uncommitted NEL record after the authoritative
Backlog transition has already been recorded.

## Why Now

This fix was originally implemented as an addendum under the already-completed
`task-2237` ("enforce local-only development") slug, riding that task's stale Forgejo
approval. It is an unrelated shared-workflow repair and is re-homed here under its own
task so it can be reviewed and merged on its own merits.

The trigger: a real handoff transitioned a task to `review` on the Backlog-owning
`main` checkout, then the mission-worktree rebase stopped on an uncommitted
`missions/<slug>/nel-record.json`. The command reported `Could not transition task ... to
review` even though the authoritative state transition had already completed.

## Scope

- In `lib/commands/handoff.ts`, after a successful NEL capture, explicitly stage the
  mission's `nel-record.json`, inspect the index (not porcelain output) to decide
  whether it changed, and commit it before the review transition runs.
- Fail closed with a clear message if staging or committing the record errors.
- Keep the change narrowly scoped to durable NEL persistence in `performHandoff`. Do not
  alter GitHub/origin routing, Forgejo review-push behavior, task-state rules, or any
  other handoff step.

## Out of Scope

- Any change to `origin`/GitHub routing or the Forgejo `review` push path.
- Broadening the handoff cleanliness check to files other than the NEL record.
- Reworking `transitionTask` or the rebase itself.

## Success Criteria

- SC1: After NEL capture, `performHandoff` stages `missions/<slug>/nel-record.json` and,
  when it is staged, commits it before `transitionTask` is called.
- SC2: The staged-state decision is made from the git index (`git diff --quiet --cached`),
  not from parsed porcelain output.
- SC3: A staging or commit failure aborts the handoff with a descriptive error and
  `{ ok: false }`.
- SC4: A focused test asserts the exact git call sequence and that the Backlog transition
  runs exactly once after the NEL commit.
- SC5: `node --test test/handoff.test.js` passes and lint/typecheck report clean on the
  changed files.

## Checkpoints

- CP1 — Implement the stage-and-commit of the NEL record before the review transition,
  add the focused regression test, and capture SC1–SC5 evidence.
