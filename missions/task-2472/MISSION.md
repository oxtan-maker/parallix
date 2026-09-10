# Mission: Keep draft classification worktree-local (task-2472)

## Goal
Make the post-draft classification flow use the mission worktree as its only
task-file authority. A draft mission must neither read nor write the primary
checkout's task file after the draft agent returns.

## Why Now
Draft agents edit the task in their isolated mission worktree. Reading a
different checkout afterward can reject that valid result and relaunch the
agent. Writing or committing labels in the primary checkout violates mission
isolation and can interfere with unrelated work there.

## Scope
- Validate and recover classification using only the task file in the mission
  worktree.
- Keep any label updates, commits, and verification artifacts in that mission
  worktree.
- Add focused coverage for a valid worktree classification and for one failed
  recovery attempt.

## Out of Scope
- Reading, writing, staging, committing, or otherwise changing a task file in
  the primary checkout or `main` branch.
- Synchronizing labels between worktrees.
- Changing classification-label definitions, task metadata parsing, prompts,
  lifecycle transitions, review, execute, or integration behavior.

## Success Criteria
- A draft-command regression test proves that a valid classification in the
  mission worktree completes without recovery, even when the primary checkout
  has a different or missing classification.
- The regression test proves the draft command performs no primary-checkout
  task-file write, label synchronization, staging, or commit.
- A missing or invalid mission-worktree classification launches one recovery
  attempt and reports a classification-validation failure if the recovered
  worktree task remains invalid.
- Required checks run from the mission worktree and leave no changes in the
  primary checkout or `main` branch.

## Risks and Assumptions
- The mission worktree remains available until post-draft validation and any
  single recovery attempt finish.
- The post-draft path must not use a primary-checkout fallback: it would make
  the result depend on mutable state outside the mission.

## Checkpoints
- CP 1: Add a focused red regression that distinguishes the mission-worktree
  task from a conflicting primary-checkout copy.
- CP 2: Make the post-draft path worktree-only and cover the one-attempt
  recovery failure.
- CP 3: Run the required checks from this worktree and record the result in
  the checkpoint.

## Gates
- [ ] `./scripts/verify-local.sh all`

## Stop Rules
- Stop and report if the mission-worktree task cannot be located after the
  draft agent returns; do not infer classification from another checkout.
- Stop and report if the proposed change requires modifying the primary
  checkout, `main`, or any other mission worktree.
