# Mission: Route backlog state changes through the integration branch (task-2230)

## Goal
Make Parallix perform every `backlog.md` task-state read/write that participates in a mission workflow from the main or selected feature/integration branch, then rebase the mission branch before mission work continues, so state transitions are visible and durable outside the mission branch.

## Why Now
The current branch-local handling of backlog task state can leave a completed transition absent from the branch that owns the backlog. This makes workflow state unreliable and risks regressions when commands read or write the same task through different paths.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: identify every backlog state-transition call path; move its branch context to the integration branch; preserve mission-branch rebase and lifecycle behavior; lock the complete workflow with focused coverage.

## Scope
- Inventory every Parallix command and workflow helper that reads or writes a task's `backlog.md` state during mission creation, activation, execution, review, handoff, integration, repair, and status transitions.
- Establish one branch-selection mechanism that targets `main` or the user-selected feature/integration branch for those backlog state operations.
- Ensure each state-changing workflow applies the backlog update on that branch and rebases the associated mission branch after the integration-branch update.
- Preserve task-file location, frontmatter format, labels, dependencies, and assignee ownership semantics while changing branch context.
- Add or update focused automated tests for each distinct state-transition route and the rebase ordering.
- Update workflow documentation or ADR material when the externally visible branch/state behavior changes.

## Out of Scope
- Redesigning the backlog schema, task states, label taxonomy, or mission directory layout.
- Changing how users choose, create, rename, or delete Git branches beyond the branch context needed for backlog state updates.
- Migrating historical backlog files or repairing pre-existing task-state inconsistencies.
- Implementing unrelated Git, worktree, review, or integration workflow changes.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Every production call path that reads or changes `backlog.md` task state is enumerated in implementation evidence and uses the shared integration-branch selection mechanism; no path continues to rely on the mission branch for a state operation.
- For each supported state transition invoked by mission lifecycle commands, the task file is updated on `main` or the selected feature/integration branch, while the mission branch is rebased afterward before subsequent mission work relies on the new state.
- Automated tests cover: default-`main` state update, selected-feature-branch state update, each distinct lifecycle state-transition route identified in the inventory, and the ordering that updates the integration branch before rebasing the mission branch.
- Existing valid task metadata is unchanged except for the requested state transition: task path, frontmatter keys, labels, dependencies, and assignee data remain intact in automated coverage.
- User-facing workflow documentation accurately states where backlog state is changed and that Parallix rebases the mission branch afterward.
- `./scripts/verify-local.sh all` completes successfully on the final tree with checkpoint evidence that names the command and relevant tests or file:line references.

## Risks and Assumptions
- Risk: state updates are implemented through indirect helpers or command-specific code, so changing only the obvious writer can leave branch-local regressions. Mitigation: create and retain a complete call-path inventory before changing behavior and derive tests from it.
- Risk: rebasing can fail because of conflicts or a missing/invalid integration branch. Assumption: existing Parallix error handling and Git abstractions define the expected failure surface; preserve it and add targeted coverage where branch selection changes it.
- Risk: worktree and branch checkout operations can alter the wrong repository state. Assumption: the current workflow has an authoritative repository/worktree abstraction that must be reused rather than bypassed.
- Risk: metadata-preservation checks can be masked by fixtures that omit real frontmatter fields. Mitigation: use fixtures containing labels, dependencies, and assignee data.

## Checkpoints
- CP 1: Map the complete `backlog.md` state-operation surface. Record every command, helper, and lifecycle route that reads or writes task state; identify its current branch context, target state, and the tests that will cover it. Do not begin behavior changes until this inventory is complete.
- CP 2: Introduce the shared integration-branch state-operation path and migrate every inventory entry to it. Add focused tests for default `main`, selected feature/integration branch, metadata preservation, and update-then-rebase ordering.
- CP 3: Update affected workflow documentation, run the required verifier, and complete the Goal Check with evidence for every success criterion and every inventory route.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary that names the lifecycle routes inspected or changed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with one evidence row for every Success Criterion.
- Evidence must use forms Parallix recognizes today: existing file:line references; exact repository test names; existing test file paths; ADR references; and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For CP 1, include the complete state-operation inventory with its command/helper and branch-context evidence. For CP 2, identify the test that proves each inventory route. For CP 3, cite the documentation location and the successful required gate.
- Raw `stat`/`ls` output or generic prose alone is not evidence. If shell output is included, pair it with an accepted file:line reference, exact test name, test file path, ADR reference, or recognized command/path.
- A specific `Next action:` line at the bottom that names the next route, change, test, documentation update, or verification command.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change the semantics or names of backlog task states without a separately approved mission.
- Do not rewrite, relocate, or bulk-migrate backlog task files.
- Do not alter task assignee ownership behavior or introduce direct Git commands that bypass Parallix's established repository/worktree abstractions.
- Do not change unrelated review, execution, integration, or worktree behavior.

## Stop Rules
- Stop and request direction if the inventory shows a state operation outside the Parallix repository/worktree abstraction, because bringing an external system into scope requires new authority.
- Stop and request direction if satisfying all state-operation routes requires changing the backlog schema or state-machine semantics.
- Stop and report the exact conflict if rebasing requires destructive Git recovery, rewriting user commits, or modifying branches not created or selected by the workflow.
- Stop and request direction if a required lifecycle route cannot be covered by an existing test harness without adding a new external service or credential.
