# Mission: Restore worktree-local backlog task transitions (task-2410)

## Goal
Restore the workflow so normal backlog-task state transitions are written in the active mission worktree, rather than being routed to the primary branch. The `px` UI must use that same behavior when it is launched from a worktree.

## Why Now
The primary branch is accumulating backlog-task state churn that belongs to individual missions. The UI now provides a usable workflow for inspecting and advancing task state from the active worktree, so the earlier primary-branch workaround is no longer justified and interferes with isolated mission work.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: The desired ownership boundary is explicit; implementation must locate and undo the historical primary-branch routing and its follow-up changes.
- Main drivers: task-state write routing, worktree isolation, and `px` UI command integration

## Scope
- Locate the change set and follow-up fixes that made backlog-task state changes write through the primary branch; revert them where their behavior is still present.
- Make normal lifecycle transitions write the affected backlog task in the active mission worktree.
- Preserve task-state transitions when `px` is launched from a mission worktree, including the UI action path that mutates task state.
- Add focused automated coverage for CLI and UI-originated state changes from a worktree.
- Update durable workflow documentation only if supported task-state ownership changes for users.

## Out of Scope
- Changing task content, task IDs, labels unrelated to this mission, or backlog ordering.
- Altering mission-branch push policy, review-remote policy, or worktree creation behavior.
- Redesigning the `px` UI or adding a second task-state storage mechanism.
- Cleaning up pre-existing backlog-task noise beyond state writes exercised by the restored workflow.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A lifecycle transition invoked from a mission worktree updates that worktree's backlog task and does not create, amend, or require a primary-branch backlog commit.
- The same transition invoked through `px` while the UI is started from a mission worktree updates the task in that worktree and completes without a primary-branch checkout or routing dependency.
- Focused tests cover both the direct workflow path and the `px`-initiated path, asserting the worktree-local write target and absence of a primary-branch write.
- Existing lifecycle behavior outside backlog-task write location remains covered by the relevant tests and passes without new focused or unannotated skipped tests.
- `./scripts/verify-local.sh all` completes successfully on the final mission tree.

## Risks and Assumptions
- Historical primary-branch routing may be split across an original task and follow-up fixes; the implementer must trace all state-write callers before reverting behavior.
- The UI may resolve its working directory differently from direct CLI commands; tests must launch it from a worktree to prove the intended boundary.
- This mission assumes backlog task files are available in each mission worktree and that state writes are valid local mission changes.
- If a transition is intentionally repository-global rather than a normal backlog-task transition, preserve that exception and document the evidence for it in the checkpoint.

## Checkpoints
- CP 1: Trace every backlog-task state-write caller, identify the historical primary-branch routing changes and follow-ups, and record the intended worktree-local ownership boundary before editing behavior.
- CP 2: Restore worktree-local task-state writes and add focused direct-workflow coverage proving the active worktree is the only write target.
- CP 3: Exercise and cover the `px` UI path from a mission worktree, update user-facing workflow documentation if behavior changes, and run the final verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST lead its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document MUST include a summary of work done, the exact heading `## Goal Check`, and this 3-column table:

| Criterion | Evidence | Status |
|---|---|---|

Include one evidence row for every Success Criterion. For the worktree-write criteria, cite the exact focused test name and test file path; for final verification, cite `./scripts/verify-local.sh all`. Raw `stat`/`ls` output or generic prose alone is not enough: if included, pair it with an accepted command, test name, test path, or ADR reference. End with a concrete `Next action:` line naming the next investigation, implementation, or verification action.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify or rewrite backlog task content except for state transitions produced by the supported lifecycle workflow.
- Do not write, commit, or push backlog-task state changes on the primary branch as part of normal mission lifecycle handling.
- Do not change `origin` push behavior or bypass the mission-branch remote restrictions.
- Do not introduce a UI-only task-state path that differs from the direct workflow path.

## Stop Rules
- Stop and request direction if tracing shows that worktree-local writes would overwrite an independently maintained primary-branch task state with no established conflict policy.
- Stop and request direction if the `px` UI cannot identify its launching worktree without changing its public invocation contract.
- Stop and request direction if restoring the previous behavior would require changing task storage or lifecycle semantics beyond write location.
