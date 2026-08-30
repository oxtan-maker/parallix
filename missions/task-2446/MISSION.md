# Mission: Recover missions stranded by lifecycle synchronization failure (task-2446)

## Goal
Provide an audited supported recovery path for missions whose worktree task lifecycle and durable aggregate lifecycle disagree after synchronization fails, allowing an interrupted non-integrated mission to resume without SQLite edits while refusing to reopen an integrated mission.

## Why Now
TASK-2438 is stranded: its worktree task remains active while the durable aggregate is closed done at version 18. The current domain rejects every follow-up command for the closed aggregate, leaving direct database edits as the only recovery route.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: repair the lifecycle boundary exposed by TASK-2438 before more mission worktrees can strand.
- Main drivers: conflicting task/aggregate persistence, no restart or reopen command, and the need to preserve integrated-mission closure.

## Scope
- Add a supported, audited lifecycle recovery or reconciliation flow that detects disagreement between a mission task record and its durable aggregate.
- Report both conflicting lifecycle states and the recovery action available to the operator.
- Permit a mission interrupted before integration to resume its existing lifecycle through the supported interface.
- Reconcile TASK-2438 through that supported path without direct SQLite edits.
- Preserve lifecycle history and reject recovery that would reopen a mission already integrated.

## Out of Scope
- Adding a general-purpose mission restart or reopen command for arbitrary closed missions.
- Rewriting historical mission records that have no task/aggregate lifecycle conflict.
- Changing task ownership, branch creation, review, or integration policy.
- Manual database repair instructions as the normal recovery mechanism.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A lifecycle test creates the TASK-2438-shaped conflict: worktree task `active` and durable aggregate `done`/closed, and it fails at the mission parent commit before recovery behavior is implemented.
- The supported recovery interface reports the task state, aggregate state, and an explicit supported recovery action when it detects a lifecycle conflict.
- Invoking the supported recovery interface for an interrupted, non-integrated conflict resumes the existing mission lifecycle without direct SQLite edits and leaves an auditable lifecycle-history record.
- Invoking recovery for a closed integrated mission is refused; its closed aggregate state, task state, and integration history remain unchanged.
- TASK-2438's persisted worktree task and durable aggregate reach compatible lifecycle states through the supported recovery path.
- Focused lifecycle/persistence tests and `./scripts/verify-local.sh static-analysis` pass.

## Risks and Assumptions
- The durable aggregate's integration evidence is the authoritative guard against reopening an integrated mission; verify the existing persistence model exposes it reliably.
- Recovery must distinguish synchronization interruption from a normal completed mission, or it could reopen work that has already integrated.
- TASK-2438's persisted data remains available in the local operator database or in a reproducible fixture when execution begins.
- The recovery operation may need explicit operator confirmation if state evidence is insufficient to classify a conflict safely.

## Checkpoints
Reproduction-Test: test/task-2446-repro.test.ts

- CP 1: Author `test/task-2446-repro.test.ts` before any production fix. It must create an `active` worktree task paired with a closed `done` durable aggregate, assert that the current supported lifecycle command rejects or cannot recover the conflict at the parent commit (red), and become green only after the supported recovery behavior is implemented.
- CP 2: Trace the lifecycle synchronization boundary and implement the smallest audited recovery/reconciliation flow that reports the conflicting states and exposes the permitted recovery action for non-integrated missions.
- CP 3: Add focused lifecycle and persistence coverage for successful non-integrated recovery, refusal for an integrated mission, and durable history preservation; execute the supported recovery path for TASK-2438 or its durable reproducible fixture.
- CP 4: Run the required verification gates and write checkpoint evidence that maps every success criterion to the executed tests, commands, and durable recovery result.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its evidence with durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table `| Criterion | Evidence | Status |` with at least one durable evidence row for every success criterion.
- For this mission, evidence for CP 1 must cite `test/task-2446-repro.test.ts` and the exact reproduction test name; later checkpoints must cite the focused lifecycle/persistence test names and the relevant recognized verification commands or paths.
- Raw `stat`/`ls` output or generic prose alone is not enough; when included, pair shell output with one of the accepted references above.
- A non-generic `Next action:` line at the bottom.

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not edit mission lifecycle records directly in SQLite to recover TASK-2438; recovery must use the supported interface being added.
- Do not alter the closed state of an integrated mission.
- Do not broaden recovery into an unrestricted reopen mechanism.
- Preserve existing lifecycle-history and persistence invariants while changing synchronization behavior.

## Stop Rules
- Stop and request a product decision if integration status cannot be determined from durable mission state; do not guess whether reopening is safe.
- Stop if the only way to reconcile TASK-2438 is manual SQLite mutation rather than the supported recovery flow.
- Stop if a proposed recovery path can change an integrated mission from closed to active, or erase lifecycle history.
